import { lstat, readFile, readdir } from 'node:fs/promises';
import * as path from 'node:path';
import MiniSearch from 'minisearch';

const MAX_JSON_BYTES = 5 * 1024 * 1024;
const excluded = /^(?:\.env(?:\..*)?|.*\.(?:pem|key)|id_rsa.*|credentials.*|node_modules|\.git)$/i;

type MemoryRecord = { id: string; text: string; kind: string; createdAt: string; meta?: Record<string, unknown> };
type PlannedTask = { id: string; text: string; plan: string; status: string; createdAt: string };

function storagePath(name: 'memory.json' | 'tasks.json'): string {
  const memoryPath = process.env.BATON_MEMORY_PATH;
  if (!memoryPath || !path.isAbsolute(memoryPath) || path.basename(memoryPath).toLowerCase() !== 'memory.json') {
    throw new Error('Set BATON_MEMORY_PATH to the absolute path of memory.json.');
  }
  return name === 'memory.json' ? memoryPath : path.join(path.dirname(memoryPath), name);
}

async function readJson(name: 'memory.json' | 'tasks.json'): Promise<unknown[]> {
  const filename = storagePath(name);
  let info;
  try {
    info = await lstat(filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  if (!info.isFile() || info.size > MAX_JSON_BYTES) throw new Error(`${name} is unavailable or too large.`);
  const value: unknown = JSON.parse(await readFile(filename, 'utf8'));
  if (!Array.isArray(value)) throw new Error(`${name} must contain a JSON array.`);
  return value;
}

export async function searchProjectContext(query: string): Promise<unknown[]> {
  if (!query.trim()) return [];
  const records = (await readJson('memory.json')).filter((item): item is MemoryRecord => {
    if (typeof item !== 'object' || item === null) return false;
    const value = item as Record<string, unknown>;
    return typeof value.id === 'string' && typeof value.text === 'string'
      && typeof value.kind === 'string' && typeof value.createdAt === 'string';
  });
  const index = new MiniSearch<MemoryRecord>({
    fields: ['text'],
    searchOptions: { prefix: true, fuzzy: 0.2 },
    processTerm: (term) => term.toLowerCase(),
  });
  index.addAll(records);
  const byId = new Map(records.map((record) => [record.id, record]));
  return index.search(query).slice(0, 5).flatMap((hit) => {
    const record = byId.get(String(hit.id));
    return record ? [{ kind: record.kind, text: record.text, createdAt: record.createdAt,
      taskId: record.meta?.taskId, score: hit.score }] : [];
  });
}

export async function getActivePlan(): Promise<unknown> {
  const tasks = (await readJson('tasks.json')).filter((item): item is PlannedTask => {
    if (typeof item !== 'object' || item === null) return false;
    const value = item as Record<string, unknown>;
    return typeof value.id === 'string' && typeof value.text === 'string'
      && typeof value.plan === 'string' && typeof value.status === 'string'
      && typeof value.createdAt === 'string';
  });
  const latest = tasks.filter((task) => task.status === 'planned' && task.plan.trim())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return latest ? { taskId: latest.id, task: latest.text, plan: latest.plan, createdAt: latest.createdAt } : null;
}

async function fileTree(root: string): Promise<string[]> {
  const lines: string[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > 2) return;
    const entries = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => !excluded.test(entry.name) && !entry.isSymbolicLink())
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      lines.push(`${'  '.repeat(depth - 1)}${entry.name}${entry.isDirectory() ? '/' : ''}`);
      if (entry.isDirectory() && depth < 2) await visit(path.join(directory, entry.name), depth + 1);
    }
  }
  await visit(root, 1);
  return lines;
}

export async function getProjectOverview(): Promise<unknown> {
  const root = path.resolve(process.env.BATON_PROJECT_ROOT ?? process.cwd());
  let readme = '';
  const readmePath = path.join(root, 'README.md');
  try {
    const info = await lstat(readmePath);
    if (info.isFile() && info.size <= 100 * 1024) {
      const content = await readFile(readmePath, 'utf8');
      readme = (content.split(/^##\s/m)[0].replace(/^#\s+[^\n]*\n/, '').trim() || content).slice(0, 1200);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return { root, readmeSummary: readme, fileTree: await fileTree(root) };
}
