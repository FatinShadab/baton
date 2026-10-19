import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { Disposable, ExtensionContext } from 'vscode';
import { z } from 'zod';
import type { ZodType, ZodTypeDef } from 'zod';
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
const STATS_FILE = 'stats.json';

const bundledFile = (context: KbContext, name: string): string =>
  path.join(context.extensionUri.fsPath, KB_DIR, name);
const storageFile = (context: KbContext, name: string): string =>
  path.join(context.globalStorageUri.fsPath, name);

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Read and validate a JSON file, naming it in every error. */
async function readJsonFile<T>(file: string, schema: ZodType<T, ZodTypeDef, unknown>, label: string): Promise<T> {
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

/** Write JSON to a file atomically. */
async function writeJsonFile(file: string, value: unknown): Promise<void> {
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

/** Load the knowledge base, falling back to the seed. */
export async function loadKB(context: KbContext): Promise<KnowledgeBase> {
  const seed = await readJsonFile(bundledFile(context, SEED_FILE), KnowledgeBaseSchema, `kb/${SEED_FILE}`);
  const savedPath = storageFile(context, KB_FILE);
  if (!(await access(savedPath).then(() => true).catch(() => false))) return seed;
  return overlay(seed, await readJsonFile(savedPath, KnowledgeBaseSchema, KB_FILE));
}

/** Save the knowledge base with a changelog entry. */
export async function saveKB(context: KbContext, kb: KnowledgeBase, reason: string): Promise<KnowledgeBase> {
  const note = reason.trim();
  if (!note) throw new Error('Baton needs a reason to save a knowledge base change.');
  const now = new Date().toISOString();
  const next = KnowledgeBaseSchema.parse({ ...kb, updated_at: now });
  const target = storageFile(context, KB_FILE);
  if (await access(target).then(() => true).catch(() => false)) await copyFile(target, storageFile(context, PREV_FILE));

  const changelogPath = storageFile(context, CHANGELOG_FILE);
  const changelog = (await access(changelogPath).then(() => true).catch(() => []))
    ? await readJsonFile(changelogPath, KbChangelogSchema, CHANGELOG_FILE)
    : [];
  await writeJsonFile(changelogPath, [...changelog, { time: now, reason: note }]);
  await writeJsonFile(target, next);
  return next;
}

/** Restore the single backup made by the last saveKB. Returns false when there is none. */
export async function undoLastKBChange(context: KbContext): Promise<boolean> {
  const previous = storageFile(context, PREV_FILE);
  if (!(await access(previous).then(() => true).catch(() => false))) return false;
  const target = storageFile(context, KB_FILE);
  const temporary = `${target}.undo.tmp`;
  await copyFile(previous, temporary);
  await rename(temporary, target);
  await rm(previous, { force: true });
  return true;
}

/** Load availability from bundled file. */
export function loadAvailability(context: KbContext): Promise<Availability> {
  return readJsonFile(bundledFile(context, 'availability.json'), AvailabilitySchema, 'kb/availability.json');
}

/** Load sources from bundled file. */
export function loadSources(context: KbContext): Promise<KbSources> {
  return readJsonFile(bundledFile(context, 'sources.json'), KbSourcesSchema, 'kb/sources.json');
}

/** Stats record schema. */
const StatsRecordSchema = z.object({
  agent_id: z.string().min(1),
  model: z.string().min(1),
  task_type: z.string().min(1),
  success: z.number().default(0),
  total: z.number().default(0),
});

export type StatsRecord = z.infer<typeof StatsRecordSchema>;

/** Stats schema - array of records. */
export const StatsSchema = z.array(StatsRecordSchema);

/** Load stats from global storage. */
export async function loadStats(context: KbContext): Promise<StatsRecord[]> {
  try {
    const raw = await readFile(storageFile(context, STATS_FILE), 'utf8');
    const parsed = StatsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** Save stats to global storage. */
export async function saveStats(context: KbContext, stats: StatsRecord[]): Promise<void> {
  await writeJsonFile(storageFile(context, STATS_FILE), stats);
}

/** Reset stats to empty array. */
export async function resetStats(context: KbContext): Promise<void> {
  await saveStats(context, []);
}

/** Register all VS Code commands for the KB module. */
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
    vscode.commands.registerCommand('baton.kb.resetStats', async () => {
      try {
        await resetStats(context);
        void vscode.window.showInformationMessage('Baton stats reset.');
      } catch (error) {
        void vscode.window.showErrorMessage(`Baton could not reset stats: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
  ];
}