import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import MiniSearch from 'minisearch';
import { buildPlanPrompt } from '../planning-prompt';

const MAX_JSON_BYTES = 5 * 1024 * 1024;
const MAX_SUMMARY_BYTES = 256 * 1024;
const TASK_ID = /^[a-f0-9]{12}$/;
const STEP_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const excluded = /^(?:\.env(?:\..*)?|.*\.(?:pem|key)|id_rsa.*|credentials.*|node_modules|\.git)$/i;

type MemoryRecord = { id: string; text: string; kind: string; createdAt: string; meta?: Record<string, unknown> };
type SavedTask = { id: string; text: string; plan?: string; status: string; createdAt: string;
  workspaceUri: string; outcome?: string; finishSummary?: string; planningPrompt?: string;
  contextSnippet?: string; decision?: string;
  route?: { risk_tier?: string; recommended_destination?: string } };

function projectRoot(): string {
  const root = process.env.BATON_PROJECT_ROOT;
  if (!root || !path.isAbsolute(root)) throw new Error('Set BATON_PROJECT_ROOT to an absolute project path.');
  return path.resolve(root);
}

function inProject(workspaceUri: unknown): boolean {
  if (typeof workspaceUri !== 'string') return false;
  const current = projectRoot();
  try {
    const saved = path.resolve(fileURLToPath(workspaceUri));
    return process.platform === 'win32'
      ? saved.toLowerCase() === current.toLowerCase() : saved === current;
  } catch {
    return false;
  }
}

function savedTasks(items: unknown[]): SavedTask[] {
  return items.filter((item): item is SavedTask => {
    if (typeof item !== 'object' || item === null) return false;
    const task = item as Record<string, unknown>;
    return typeof task.id === 'string' && typeof task.text === 'string'
      && typeof task.status === 'string' && typeof task.createdAt === 'string'
      && inProject(task.workspaceUri);
  });
}

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
      && typeof value.kind === 'string' && typeof value.createdAt === 'string'
      && typeof value.meta === 'object' && value.meta !== null
      && inProject((value.meta as Record<string, unknown>).workspaceUri);
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
  const tasks = savedTasks(await readJson('tasks.json'));
  const latest = tasks.filter((task) => task.status === 'planned' && task.plan?.trim())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return latest ? { taskId: latest.id, task: latest.text, plan: latest.plan, createdAt: latest.createdAt } : null;
}

export async function getProjectHistory(): Promise<unknown[]> {
  return savedTasks(await readJson('tasks.json'))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20)
    .map((task) => ({ taskId: task.id, task: task.text.slice(0, 1200), status: task.status,
      createdAt: task.createdAt, risk: task.route?.risk_tier,
      destination: task.route?.recommended_destination, outcome: task.outcome,
      finishSummary: task.finishSummary,
      planSummary: task.plan?.slice(0, 1000) }));
}

export async function getTaskSummary(taskId: string): Promise<unknown> {
  const task = savedTasks(await readJson('tasks.json')).find((entry) => entry.id === taskId);
  return task ? { taskId: task.id, task: task.text, status: task.status,
    finishSummary: task.finishSummary ?? null, outcome: task.outcome ?? null } : null;
}

async function fileTree(root: string): Promise<string[]> {
  const lines: string[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > 2 || lines.length >= 200) return;
    const entries = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => !excluded.test(entry.name) && !entry.isSymbolicLink())
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (lines.length >= 200) break;
      lines.push(`${'  '.repeat(depth - 1)}${entry.name}${entry.isDirectory() ? '/' : ''}`);
      if (entry.isDirectory() && depth < 2) await visit(path.join(directory, entry.name), depth + 1);
    }
  }
  await visit(root, 1);
  return lines;
}

export async function getProjectOverview(): Promise<unknown> {
  const root = projectRoot();
  let readme = '';
  let projectNotes = '';
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
  try {
    const notesFile = path.join(projectStoragePath(), 'project.md');
    const info = await lstat(notesFile);
    if (info.isFile() && info.size <= 100 * 1024) projectNotes = (await readFile(notesFile, 'utf8')).slice(0, 4000);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return { root, readmeSummary: readme, projectNotes, fileTree: await fileTree(root) };
}

function projectStoragePath(): string {
  const root = projectRoot();
  const key = createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 12);
  const slug = path.basename(root).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'task';
  return path.join(path.dirname(storagePath('memory.json')), 'projects', `${slug}_${key}`);
}

async function findTaskFolder(taskId: string): Promise<string | undefined> {
  if (!TASK_ID.test(taskId)) throw new Error('Invalid task ID.');
  const tasksDir = path.join(projectStoragePath(), 'tasks');
  const entries = await readdir(tasksDir, { withFileTypes: true }).catch(() => []);
  const task = entries.find((entry) => entry.isDirectory() && entry.name.startsWith(`${taskId}_`));
  return task ? path.join(tasksDir, task.name) : undefined;
}

async function readSummary(file: string, taskFolder: string): Promise<unknown> {
  const [actual, taskRoot] = await Promise.all([realpath(file), realpath(taskFolder)]);
  const relative = path.relative(taskRoot, actual);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Summary path is outside the task.');
  const info = await lstat(file);
  if (!info.isFile() || info.size > MAX_SUMMARY_BYTES) throw new Error('Summary is unavailable or too large.');
  return JSON.parse(await readFile(file, 'utf8'));
}

async function readTaskText(taskFolder: string, relativeFile: string): Promise<string> {
  if (path.isAbsolute(relativeFile) || relativeFile.split(/[\\/]/).some((part) => part === '..' || excluded.test(part))) {
    throw new Error('Invalid task file path.');
  }
  const file = path.join(taskFolder, relativeFile);
  const [actual, taskRoot] = await Promise.all([realpath(file), realpath(taskFolder)]);
  const relative = path.relative(taskRoot, actual);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Task file is outside the task.');
  }
  const info = await lstat(file);
  if (!info.isFile() || info.size > MAX_SUMMARY_BYTES) throw new Error('Task file is unavailable or too large.');
  return readFile(file, 'utf8');
}

async function optionalTaskText(folder: string | undefined, relativeFile: string): Promise<string | undefined> {
  if (!folder) return undefined;
  try { return await readTaskText(folder, relativeFile); } catch { return undefined; }
}

async function optionalTaskJson(folder: string | undefined, relativeFile: string): Promise<Record<string, unknown> | undefined> {
  const text = await optionalTaskText(folder, relativeFile);
  if (!text) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

/** Return the saved request, prompts, plan, and summaries for one project-scoped task. */
export async function getTaskContext(taskId: string): Promise<unknown> {
  if (!TASK_ID.test(taskId)) throw new Error('Invalid task ID.');
  const saved = savedTasks(await readJson('tasks.json')).find((task) => task.id === taskId);
  const folder = await findTaskFolder(taskId);
  if (!saved && !folder) return null;

  const [request, planningPrompt, state, triage, race, stepSummaries] = await Promise.all([
    optionalTaskText(folder, 'task.md'),
    optionalTaskText(folder, 'planning_prompt.md'),
    optionalTaskJson(folder, 'state.json'),
    optionalTaskJson(folder, 'triage.json'),
    optionalTaskJson(folder, 'race_map.json'),
    folder ? listSummaries(taskId).then((value) => (value as { summaries: unknown[] }).summaries) : [],
  ]);
  const planFile = typeof state?.plan_file === 'string' ? state.plan_file : undefined;
  const plan = planFile ? await optionalTaskText(folder, planFile) : undefined;
  const handoffs: Array<{ step_id: string; prompt: string }> = [];
  for (const step of Array.isArray(race?.steps) ? race.steps.slice(0, 20) : []) {
    if (!step || typeof step !== 'object') continue;
    const item = step as Record<string, unknown>;
    if (typeof item.id !== 'string' || !STEP_ID.test(item.id)
      || typeof item.handoff !== 'string' || !/^handoffs[/\\]H\d+\.md$/.test(item.handoff)) continue;
    const prompt = await optionalTaskText(folder, item.handoff);
    if (prompt) handoffs.push({ step_id: item.id, prompt });
  }
  let planSummary: unknown = null;
  if (folder) try { planSummary = await getPlanSummary(taskId); } catch { /* No summary yet. */ }
  return {
    taskId, request: request ?? saved?.text ?? null,
    status: state?.status ?? saved?.status ?? null,
    planningPrompt: planningPrompt ?? saved?.planningPrompt
      ?? (saved?.text ? buildPlanPrompt(saved.text, saved.contextSnippet ?? '') : null),
    contextSnippet: saved?.contextSnippet ?? null,
    plan: plan ?? saved?.plan ?? null,
    planSummary, handoffs, stepSummaries,
    triage: triage ?? null, outcome: saved?.outcome ?? null,
    finishSummary: saved?.finishSummary ?? null,
  };
}

export async function getTaskPrompt(taskId: string, kind: 'planning' | 'handoff', stepId?: string): Promise<unknown> {
  if (kind === 'handoff' && (!stepId || !STEP_ID.test(stepId))) throw new Error('A valid step ID is required.');
  const context = await getTaskContext(taskId) as {
    planningPrompt: string | null; handoffs: Array<{ step_id: string; prompt: string }>
  } | null;
  if (!context) return null;
  return kind === 'planning'
    ? { taskId, kind, prompt: context.planningPrompt }
    : { taskId, kind, stepId, prompt: context.handoffs.find((item) => item.step_id === stepId)?.prompt ?? null };
}

export async function getStepSummary(taskId: string, stepId: string): Promise<unknown> {
  if (!STEP_ID.test(stepId)) throw new Error('Invalid step ID.');
  const folder = await findTaskFolder(taskId);
  if (!folder) throw new Error(`Task ${taskId} not found.`);
  const summaryFile = path.join(folder, 'step_summaries', `${stepId}.json`);
  try {
    return await readSummary(summaryFile, folder);
  } catch {
    throw new Error(`Summary for step ${stepId} in task ${taskId} was not found.`);
  }
}

export async function listSummaries(taskId: string): Promise<unknown> {
  const folder = await findTaskFolder(taskId);
  if (!folder) throw new Error(`Task ${taskId} not found.`);
  const summariesDir = path.join(folder, 'step_summaries');
  const entries = await readdir(summariesDir).catch(() => []);
  const summaries: unknown[] = [];
  for (const entry of entries.slice(0, 100)) {
    if (!entry.endsWith('.json')) continue;
    try {
      summaries.push(await readSummary(path.join(summariesDir, entry), folder));
    } catch {
      // Ignore unparseable
    }
  }
  return { taskId, summaries };
}

export async function getPlanSummary(taskId: string): Promise<unknown> {
  const folder = await findTaskFolder(taskId);
  if (!folder) throw new Error(`Task ${taskId} not found.`);
  const state = await optionalTaskJson(folder, 'state.json');
  if (typeof state?.plan_file === 'string' && /^plans[/\\][a-zA-Z0-9][\w.-]*\.md$/.test(state.plan_file)) {
    try { return JSON.parse(await readTaskText(folder, state.plan_file.replace(/\.md$/, '.summary.json'))); }
    catch { /* Fall back to an older summary or race map. */ }
  }
  const plansDir = path.join(folder, 'plans');
  const entries = await readdir(plansDir).catch(() => []);
  const summaryFile = entries.find((e) => e.endsWith('.summary.json'));
  if (summaryFile) {
    try {
      return await readSummary(path.join(plansDir, summaryFile), folder);
    } catch {
      // fallback
    }
  }
  const raceFile = path.join(folder, 'race_map.json');
  try {
    return await readSummary(raceFile, folder);
  } catch {
    throw new Error(`Plan summary for task ${taskId} was not found.`);
  }
}
