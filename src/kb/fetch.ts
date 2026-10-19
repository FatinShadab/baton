import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { parse } from 'node-html-parser';
import type { Disposable, ExtensionContext } from 'vscode';
import { z } from 'zod';
import type { KbSources } from './types';
import { isAllowedHost, isAllowedUrl } from './urlpolicy';
import { loadSources } from './store';

export type FetchDeps = {
  globalStorageUri: { readonly fsPath: string };
  sources: KbSources;
  /** Injectable clock so cache freshness stays deterministic in scripts. */
  now?: Date;
};

export type FetchResult = {
  url: string;
  ok: boolean;
  status: number;
  text: string;
  hash: string;
  fetched_at: string | null;
  error?: string;
  from_cache?: boolean;
};

const USER_AGENT = 'Baton-KB/0.1';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 3;
const MAX_BYTES = 1_500_000;
const MIN_TEXT_CHARS = 400;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_DIR = 'kb-cache';
const ALLOWED_CONTENT = ['text/html', 'text/markdown', 'text/plain'];
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const REMOVED_TAGS = 'script,style,noscript,nav,footer,header,svg';
const CONTENT_TAGS = 'h1,h2,h3,h4,h5,h6,p,li,pre,code,td,th';
const CONTENT_TAG_NAMES = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'LI', 'PRE', 'CODE', 'TD', 'TH']);

const CacheSchema = z.object({
  url: z.string(),
  text: z.string(),
  hash: z.string(),
  fetched_at: z.string(),
});
type CacheEntry = z.infer<typeof CacheSchema>;

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const detail = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function failure(url: string, error: string, status = 0): FetchResult {
  return { url, ok: false, status, text: '', hash: '', fetched_at: null, error, from_cache: false };
}

/** HTML -> visible text. Scripts, chrome, and SVG are dropped; blocks stay separate. */
export function htmlToText(html: string): string {
  const root = parse(html);
  for (const node of root.querySelectorAll(REMOVED_TAGS)) node.remove();
  // Nested blocks (code inside pre, list items inside list items) are covered by
  // their parent, so skip them instead of repeating the same text.
  const nested = (node: { parentNode: unknown }): boolean => {
    let parent = node.parentNode as { tagName?: string; parentNode?: unknown } | null;
    while (parent) {
      if (parent.tagName && CONTENT_TAG_NAMES.has(parent.tagName)) return true;
      parent = parent.parentNode as typeof parent;
    }
    return false;
  };
  const blocks = root.querySelectorAll(CONTENT_TAGS)
    .filter((node) => !nested(node))
    .map((node) => node.textContent.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const text = blocks.length ? blocks.join('\n') : root.textContent.replace(/\s+/g, ' ').trim();
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function cachePath(deps: FetchDeps, url: string): string {
  return path.join(deps.globalStorageUri.fsPath, CACHE_DIR, `${sha256(url)}.json`);
}

async function readCache(file: string, url: string, now: Date): Promise<CacheEntry | undefined> {
  try {
    const parsed = CacheSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
    if (!parsed.success || parsed.data.url !== url) return undefined;
    const time = Date.parse(parsed.data.fetched_at);
    if (!Number.isFinite(time) || now.getTime() - time >= CACHE_TTL_MS) return undefined;
    return parsed.data;
  } catch {
    return undefined;
  }
}

async function writeCache(file: string, entry: CacheEntry): Promise<void> {
  try {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    await writeFile(temporary, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
    await rename(temporary, file);
  } catch {
    // A cache write failure must not fail the fetch.
  }
}

type BodyResult = { ok: true; text: string } | { ok: false; error: string };

async function readCapped(body: ReadableStream<Uint8Array> | null): Promise<BodyResult> {
  if (!body) return { ok: true, text: '' };
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let total = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, error: 'response exceeded 1.5 MB' };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, text };
  } finally {
    reader.releaseLock();
  }
}

/** A listed source may override the timeout; clamp to the schema's range. */
function timeoutFor(deps: FetchDeps, url: string): number {
  const entry = deps.sources.sources.find((source) => source.url === url);
  const value = entry?.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(value, 1), MAX_TIMEOUT_MS);
}

async function download(url: string, deps: FetchDeps, now: Date, timeoutMs: number): Promise<FetchResult> {
  const allowedDomains = deps.sources.allowed_domains;
  const timeoutLabel = `${timeoutMs / 1000}s`;
  let current = url;
  let redirects = 0;

  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        credentials: 'omit',
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html, text/markdown, text/plain' },
      });
    } catch {
      clearTimeout(timer);
      return failure(url, controller.signal.aborted
        ? `request timed out after ${timeoutLabel}`
        : 'network request failed');
    }

    if (REDIRECTS.has(response.status)) {
      clearTimeout(timer);
      await response.body?.cancel().catch(() => undefined);
      const location = response.headers.get('location');
      if (!location) return failure(url, `HTTP ${response.status} redirect without a Location header`, response.status);
      if (redirects >= MAX_REDIRECTS) return failure(url, 'too many redirects', response.status);
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return failure(url, 'redirect target is not a valid URL', response.status);
      }
      const host = isAllowedHost(next.toString(), allowedDomains);
      if (!host.ok) return failure(url, `redirect blocked: ${host.reason ?? 'host not allowed'}`, response.status);
      current = next.toString();
      redirects++;
      continue;
    }

    const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_CONTENT.some((prefix) => contentType.startsWith(prefix))) {
      clearTimeout(timer);
      await response.body?.cancel().catch(() => undefined);
      return failure(url, `unsupported content type "${contentType || 'unknown'}"`, response.status);
    }

    let body: BodyResult;
    try {
      body = await readCapped(response.body);
    } catch {
      clearTimeout(timer);
      return failure(url, controller.signal.aborted ? `request timed out after ${timeoutLabel}` : 'response body could not be read', response.status);
    }
    clearTimeout(timer);
    if (!body.ok) return failure(url, body.error, response.status);

    const text = contentType.startsWith('text/html') ? htmlToText(body.text) : body.text;
    if (text.length < MIN_TEXT_CHARS) {
      return failure(url, 'page empty or likely JavaScript-rendered', response.status);
    }

    const hash = sha256(text);
    const fetchedAt = now.toISOString();
    await writeCache(cachePath(deps, url), { url, text, hash, fetched_at: fetchedAt });
    return { url, ok: true, status: response.status, text, hash, fetched_at: fetchedAt, from_cache: false };
  }
}

/**
 * Fetch one listed source. Every failure returns ok:false instead of throwing.
 * Redirects are followed manually so each hop can be checked against the host policy.
 */
export async function fetchSource(
  url: string,
  deps: FetchDeps,
  options: { force?: boolean } = {},
): Promise<FetchResult> {
  const now = deps.now ?? new Date();
  const policy = isAllowedUrl(url, deps.sources.allowed_domains, deps.sources.sources.map((entry) => entry.url));
  if (!policy.ok) return failure(url, policy.reason ?? 'URL is not allowed');

  const file = cachePath(deps, url);
  if (!options.force) {
    const cached = await readCache(file, url, now);
    if (cached) {
      return {
        url,
        ok: true,
        status: 200,
        text: cached.text,
        hash: cached.hash,
        fetched_at: cached.fetched_at,
        from_cache: true,
      };
    }
  }

  const timeoutMs = timeoutFor(deps, url);
  const attempt = async (limit: number): Promise<FetchResult> => {
    try {
      return await download(url, deps, now, limit);
    } catch (error) {
      return failure(url, detail(error));
    }
  };

  const first = await attempt(timeoutMs);
  if (first.ok || !first.error?.startsWith('request timed out')) return first;
  // One retry for timeouts only; 403/404 and other failures are final.
  return attempt(Math.min(timeoutMs * 2, MAX_TIMEOUT_MS));
}

/**
 * Wire into activate() with context.subscriptions.push(...registerSourceCommands(context)).
 * vscode is required lazily so plain Node scripts can import the fetcher.
 */
export function registerSourceCommands(context: ExtensionContext): Disposable[] {
  const vscode = require('vscode') as typeof import('vscode');

  const preview = async (): Promise<void> => {
    try {
      const sources = await loadSources(context);
      if (!sources.sources.length) {
        void vscode.window.showInformationMessage('Baton: kb/sources.json has no sources to preview.');
        return;
      }
      const picked = await vscode.window.showQuickPick(
        sources.sources.map((entry) => ({
          label: entry.url,
          description: entry.agent_id,
          detail: entry.note,
        })),
        { placeHolder: 'Choose a knowledge-base source to fetch' },
      );
      if (!picked) return;

      const result = await fetchSource(picked.label, { globalStorageUri: context.globalStorageUri, sources }, { force: true });
      if (!result.ok) {
        void vscode.window.showErrorMessage(`Baton could not fetch ${picked.label}: ${result.error ?? 'unknown error'}`);
        return;
      }
      const document = await vscode.workspace.openTextDocument({
        content: result.text.slice(0, 3000),
        language: 'markdown',
      });
      await vscode.window.showTextDocument(document);
      void vscode.window.showInformationMessage(
        `Baton: ${result.text.length} chars, hash ${result.hash.slice(0, 8)}, ${result.from_cache ? 'from cache' : 'fetched live'}.`,
      );
    } catch (error) {
      void vscode.window.showErrorMessage(`Baton could not preview a source: ${detail(error)}`);
    }
  };

  return [vscode.commands.registerCommand('baton.kb.previewSource', preview)];
}
