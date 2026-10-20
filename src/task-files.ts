import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, appendFile } from 'node:fs/promises';
import * as path from 'node:path';
import { PlanSummary, RaceMap, RaceMapSchema, StateFile, StateFileSchema, TaskState, TerminalStates, Triage, TriageSchema, nextAction } from './task-model';

export type TaskLocation = { project: string; task: string; id: string; slug: string };
export type ListedTask = TaskLocation & { state: TaskState; nextAction: string };

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'task';
}

const TRANSITIONS: Record<TaskState, TaskState[]> = {
  opened: ['triaged'],
  triaged: ['awaiting_plan', 'race_ready', 'done', 'abandoned'],
  awaiting_plan: ['plan_saved', 'race_ready', 'done', 'abandoned'],
  plan_saved: ['race_ready', 'done', 'abandoned'],
  race_ready: ['plan_saved', 'running', 'done', 'abandoned'],
  running: ['done', 'abandoned'],
  done: [],
  abandoned: [],
};

export class TaskFiles {
  constructor(private readonly storageRoot: string) {}

  projectPath(repoPath: string): string {
    const key = createHash('sha256').update(path.resolve(repoPath).toLowerCase()).digest('hex').slice(0, 12);
    return path.join(this.storageRoot, 'projects', `${slugify(path.basename(repoPath))}_${key}`);
  }

  async ensureProject(repoPath: string, name = path.basename(repoPath)): Promise<string> {
    const project = this.projectPath(repoPath);
    await mkdir(path.join(project, 'tasks'), { recursive: true });
    const metadata = path.join(project, 'project.md');
    try { await readFile(metadata); } catch {
      await writeFile(metadata, `# ${name}\n\nRepo path: ${path.resolve(repoPath)}\n\n## Standing constraints\n- Never read or send .env, *.pem, *.key, id_rsa*, credentials*, node_modules, or .git.\n- Use TypeScript, esbuild, and vanilla HTML/CSS/JS.\n\n## Agent and model preferences\n- code.low: codex/gpt-6.1-sol\n- code.med: codex/gpt-6.1-sol\n- code.high: codex/gpt-6-astra\n- refactor.high: codex/gpt-6-astra\n- docs.low: copilot/Auto\n- research.high: antigravity/gemini-4-argon\n`, 'utf8');
    }
    return project;
  }

  async createTask(repoPath: string, title: string, parentTaskId?: string): Promise<TaskLocation> {
    const project = await this.ensureProject(repoPath);
    const slug = slugify(title);
    let id = '';
    let task = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      id = randomUUID().replace(/-/g, '').slice(0, 12);
      task = path.join(project, 'tasks', `${id}_${slug}`);
      try { await mkdir(task); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt === 4) throw error;
      }
    }
    await mkdir(path.join(task, 'plans'), { recursive: true });
    await mkdir(path.join(task, 'handoffs'), { recursive: true });
    await writeFile(path.join(task, 'task.md'), `# ${title.trim()}\n`, 'utf8');
    const state: StateFile = { status: 'opened', history: [{ status: 'opened', at: new Date().toISOString(), reason: 'Task created' }],
      ...(parentTaskId ? { parent_task_id: parentTaskId } : {}) };
    await this.writeJson(path.join(task, 'state.json'), state);
    await this.log(task, 'task_created', { title, parentTaskId });
    return { project, task, id, slug };
  }

  async findTask(repoPath: string, id: string): Promise<TaskLocation | undefined> {
    if (!/^[a-f0-9]{12}$/.test(id)) return undefined;
    const project = this.projectPath(repoPath);
    const names = await readdir(path.join(project, 'tasks')).catch(() => []);
    const name = names.find((entry) => entry.startsWith(`${id}_`));
    return name ? { project, task: path.join(project, 'tasks', name), id, slug: name.slice(13) } : undefined;
  }

  async listTasks(repoPath: string): Promise<ListedTask[]> {
    const project = this.projectPath(repoPath);
    const names = await readdir(path.join(project, 'tasks')).catch(() => []);
    const listed: ListedTask[] = [];
    for (const name of names) {
      if (!/^[a-f0-9]{12}_/.test(name)) continue;
      const task = path.join(project, 'tasks', name);
      try {
        const state = await this.state(task);
        listed.push({ project, task, id: name.slice(0, 12), slug: name.slice(13), state: state.status,
          nextAction: nextAction(state.status) });
      } catch { /* Ignore malformed task folders. */ }
    }
    return listed;
  }

  async state(task: string): Promise<StateFile> {
    return StateFileSchema.parse(JSON.parse(await readFile(path.join(task, 'state.json'), 'utf8')));
  }

  async transition(task: string, status: TaskState, reason: string): Promise<StateFile> {
    const state = await this.state(task);
    if (TerminalStates.has(state.status)) throw new Error('Closed tasks are read-only. Create a linked follow-up task.');
    if (state.status !== status && !TRANSITIONS[state.status].includes(status) && !reason.startsWith('Migrated')) {
      throw new Error(`Invalid task transition: ${state.status} -> ${status}.`);
    }
    if (state.status !== status) state.history.push({ status, at: new Date().toISOString(), reason });
    state.status = status;
    await this.writeJson(path.join(task, 'state.json'), state);
    await this.log(task, 'transition', { status, reason });
    return state;
  }

  async writeTriage(task: string, triage: Triage): Promise<void> {
    await this.writeJson(path.join(task, 'triage.json'), TriageSchema.parse(triage));
  }

  async readTriage(task: string): Promise<Triage> {
    return TriageSchema.parse(JSON.parse(await readFile(path.join(task, 'triage.json'), 'utf8')));
  }

  async writeRace(task: string, race: RaceMap): Promise<void> {
    await this.writeJson(path.join(task, 'race_map.json'), RaceMapSchema.parse(race));
  }

  async readRace(task: string): Promise<RaceMap | undefined> {
    try { return RaceMapSchema.parse(JSON.parse(await readFile(path.join(task, 'race_map.json'), 'utf8'))); }
    catch { return undefined; }
  }

  async savePlan(location: TaskLocation, content: string, summary?: PlanSummary): Promise<string> {
    const current = await this.state(location.task);
    const filename = `plan_${location.slug}_${randomUUID().slice(0, 4)}.md`;
    const relative = current.plan_file ?? path.join('plans', filename);
    await writeFile(path.join(location.task, relative), content, 'utf8');
    if (summary) {
      const summaryFilename = relative.replace(/\.md$/, '.summary.json');
      await writeFile(path.join(location.task, summaryFilename), JSON.stringify(summary, null, 2), 'utf8');
    }
    const state = await this.transition(location.task, 'plan_saved', 'Validated plan saved');
    state.plan_file = relative;
    await this.writeJson(path.join(location.task, 'state.json'), state);
    return relative;
  }

  async saveStepSummary(task: string, stepId: string, summary: string): Promise<void> {
    const dir = path.join(task, 'step_summaries');
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${stepId}.json`);
    const data = { step_id: stepId, summary: summary.trim(), saved_at: new Date().toISOString() };
    await writeFile(file, JSON.stringify(data, null, 2), 'utf8');
    await this.log(task, 'step_summary_saved', { step_id: stepId, summary: summary.trim() });
  }

  async getStepSummary(task: string, stepId: string): Promise<{ step_id: string; summary: string; saved_at: string } | undefined> {
    try {
      const file = path.join(task, 'step_summaries', `${stepId}.json`);
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {
      return undefined;
    }
  }

  async listStepSummaries(task: string): Promise<Array<{ step_id: string; summary: string; saved_at: string }>> {
    const dir = path.join(task, 'step_summaries');
    const files = await readdir(dir).catch(() => []);
    const results: Array<{ step_id: string; summary: string; saved_at: string }> = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const item = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
        if (item && typeof item.step_id === 'string' && typeof item.summary === 'string') {
          results.push(item);
        }
      } catch {
        // Skip malformed
      }
    }
    return results;
  }

  async log(task: string, event: string, data: object = {}): Promise<void> {
    const rawData = data as Record<string, unknown>;
    const inferredTaskId = (typeof rawData.task_id === 'string' && rawData.task_id)
      || path.basename(task).split('_')[0] || 'unknown';
    const inferredProjectId = (typeof rawData.project_id === 'string' && rawData.project_id)
      || path.basename(path.dirname(path.dirname(task))) || 'unknown';
    const inferredRunId = (typeof rawData.run_id === 'string' && rawData.run_id) || 'default';

    const entry = {
      at: new Date().toISOString(),
      project_id: inferredProjectId,
      task_id: inferredTaskId,
      run_id: inferredRunId,
      event,
      ...data,
    };
    await appendFile(path.join(task, 'log.jsonl'), JSON.stringify(entry) + '\n', 'utf8');
  }

  private async writeJson(file: string, data: object): Promise<void> {
    await writeFile(file, JSON.stringify(data, null, 2), 'utf8');
  }
}
