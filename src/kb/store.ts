import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { Disposable, ExtensionContext } from 'vscode';
import type { ZodType } from 'zod';
import {
  Availability,
  AvailabilitySchema,
  KbChangelogSchema,
  KbSources,
  KbSourcesSchema,
  KnowledgeBase,
  KnowledgeBaseSchema,
} from './types';

/** Structural subset of ExtensionContext so this module also runs under plain Node. */
export type KbContext = {
  readonly extensionUri: { readonly fsPath: string };
  readonly globalStorageUri: { readonly fsPath: string };
};

const KB_DIR = 'kb';
const SEED_FILE = 'agents.seed.json';
const KB_FILE = 'kb.json';
const PREV_FILE = 'kb.prev.json';
const CHANGELOG_FILE = 'kb.changelog.json';

const bundledFile = (context: KbContext, name: string): string =>
  path.join(context.extensionUri.fsPath, KB_DIR, name);
const storageFile = (context: KbContext, name: string): string =>
  path.join(context.globalStorageUri.fsPath, name);

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** Reads and validates one JSON file, naming it in every error. */
async function readJson<T>(file: string, schema: ZodType<T>, label: string): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    throw new Error(`Baton could not read ${label} (${file}): ${detail(error)}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${label} (${file}): ${detail(error)}`);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
    throw new Error(`Invalid ${label} (${file}): ${issues}`);
  }
  return parsed.data;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}

/** kb.json entries win over the seed; seed-only entries stay available. */
function overlay(seed: KnowledgeBase, saved: KnowledgeBase): KnowledgeBase {
  const merge = <T extends { id: string }>(base: T[], top: T[]): T[] => {
    const byId = new Map(base.map((entry) => [entry.id, entry] as const));
    for (const entry of top) byId.set(entry.id, entry);
    return [...byId.values()];
  };
  return {
    version: Math.max(seed.version, saved.version),
    updated_at: saved.updated_at,
    agents: merge(seed.agents, saved.agents),
    models: merge(seed.models, saved.models),
  };
}

export async function loadKB(context: KbContext): Promise<KnowledgeBase> {
  const seed = await readJson(bundledFile(context, SEED_FILE), KnowledgeBaseSchema, `kb/${SEED_FILE}`);
  const savedPath = storageFile(context, KB_FILE);
  if (!(await exists(savedPath))) return seed;
  return overlay(seed, await readJson(savedPath, KnowledgeBaseSchema, KB_FILE));
}

export async function saveKB(context: KbContext, kb: KnowledgeBase, reason: string): Promise<KnowledgeBase> {
  const note = reason.trim();
  if (!note) throw new Error('Baton needs a reason to save a knowledge base change.');
  const now = new Date().toISOString();
  const next = KnowledgeBaseSchema.parse({ ...kb, updated_at: now });
  const target = storageFile(context, KB_FILE);
  if (await exists(target)) await copyFile(target, storageFile(context, PREV_FILE));

  const changelogPath = storageFile(context, CHANGELOG_FILE);
  const changelog = (await exists(changelogPath))
    ? await readJson(changelogPath, KbChangelogSchema, CHANGELOG_FILE)
    : [];
  await writeJson(changelogPath, [...changelog, { time: now, reason: note }]);
  await writeJson(target, next);
  return next;
}

/** Restores the single backup made by the last saveKB. Returns false when there is none. */
export async function undoLastKBChange(context: KbContext): Promise<boolean> {
  const previous = storageFile(context, PREV_FILE);
  if (!(await exists(previous))) return false;
  const target = storageFile(context, KB_FILE);
  const temporary = `${target}.undo.tmp`;
  await copyFile(previous, temporary);
  await rename(temporary, target);
  await rm(previous, { force: true });
  return true;
}

export function loadAvailability(context: KbContext): Promise<Availability> {
  return readJson(bundledFile(context, 'availability.json'), AvailabilitySchema, 'kb/availability.json');
}

export function loadSources(context: KbContext): Promise<KbSources> {
  return readJson(bundledFile(context, 'sources.json'), KbSourcesSchema, 'kb/sources.json');
}

/**
 * Wire into activate() with context.subscriptions.push(...registerKbCommands(context)).
 * vscode is required lazily so the KB core stays importable outside the extension host.
 */
export function registerKbCommands(context: ExtensionContext): Disposable[] {
  const vscode = require('vscode') as typeof import('vscode');
  const open = (name: string) => async (): Promise<void> => {
    try {
      const uri = vscode.Uri.joinPath(context.extensionUri, KB_DIR, name);
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
    } catch {
      void vscode.window.showErrorMessage(`Baton could not open kb/${name}.`);
    }
  };
  return [
    vscode.commands.registerCommand('baton.kb.openSources', open('sources.json')),
    vscode.commands.registerCommand('baton.kb.openAvailability', open('availability.json')),
  ];
}
