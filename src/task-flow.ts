import { appendFile, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { allowed } from './path-policy';
import { taskDigest } from './task-digest';
import { TaskFiles, TaskLocation } from './task-files';
import { PlanFormatError, FORMAT_FIX_PROMPT, parsePlanSummary } from './plan-summary';
import { extractOrGetPlanSummary } from './plan-extractor';
import { buildRace, handoffText, overlapWarnings, readPreferences, saveRace } from './race-map';
import { checkScope } from './task-scope';
import { planningPrompt, triageTask } from './task-triage';
import { PlanSummary, RaceMap, TerminalStates } from './task-model';

export type FlowStart = { location: TaskLocation; needsPlanning: boolean; prompt?: string; platform?: string;
  attachFiles: string[]; warning: string[]; reason: string };

export class TaskFlow {
  readonly files: TaskFiles;
  constructor(storageRoot: string, private readonly extensionRoot?: string) { this.files = new TaskFiles(storageRoot); }

  private async availability(): Promise<{ agents: string[]; models: string[] } | undefined> {
    if (!this.extensionRoot) return undefined;
    try {
      const raw = JSON.parse(await readFile(path.join(this.extensionRoot, 'kb', 'availability.json'), 'utf8')) as {
        agents?: string[]; models?: Array<{ name: string }> };
      return { agents: raw.agents?.slice(0, 20) ?? [], models: raw.models?.map((entry) => entry.name).slice(0, 30) ?? [] };
    } catch { return undefined; }
  }

  async start(repoPath: string, title: string, parentTaskId?: string): Promise<FlowStart> {
    const location = await this.files.createTask(repoPath, title, parentTaskId);
    const digest = await taskDigest(repoPath, location.project, title, await this.availability());
    const triage = await triageTask(title, digest);
    await this.files.writeTriage(location.task, triage);
    await this.files.transition(location.task, 'triaged', triage.reason);
    if (triage.needs_planning) {
      const prompt = planningPrompt(title, digest, triage, location.slug);
      await writeFile(path.join(location.task, 'planning_prompt.md'), prompt, 'utf8');
      await this.files.transition(location.task, 'awaiting_plan', 'Waiting for external plan');
      return { location, needsPlanning: true, prompt, platform: triage.platform,
        attachFiles: triage.attach_files, warning: [], reason: triage.reason };
    }
    const summary: PlanSummary = {
      task: location.slug, goal: title, risks: [],
      steps: [{ id: 'S1', title,
        type: /\b(docs?|readme|document)\b/i.test(title) ? 'docs'
          : /\btest\b/i.test(title) ? 'test'
          : /\breview\b/i.test(title) ? 'review' : 'code',
        complexity: triage.complexity,
        depends_on: [], parallel_group: 'A', files: triage.attach_files,
        plan_ref: 'task.md', acceptance: 'Task request is satisfied and changes are reviewed.' }],
    };
    const race = buildRace(summary, location.id, undefined, await readPreferences(location.project));
    await saveRace(this.files, location, race);
    return { location, needsPlanning: false, attachFiles: triage.attach_files,
      warning: await overlapWarnings(this.files, repoPath, location, race), reason: triage.reason };
  }

  async submitPlan(repoPath: string, id: string, plan: string, attachedFiles: string[] = []): Promise<{ notice: string; changed: string[]; summary: PlanSummary }> {
    const location = await this.files.findTask(repoPath, id);
    if (!location) throw new Error('Task is not in this project.');
    const state = await this.files.state(location.task);
    if (TerminalStates.has(state.status)) throw new Error('Closed tasks are read-only. Create a linked follow-up task.');
    if (!['awaiting_plan', 'race_ready', 'plan_saved'].includes(state.status)) throw new Error('Plan changes are unavailable while this task is running.');

    const { summary } = await extractOrGetPlanSummary(plan, location.slug, path.join(location.task, 'plans'));
    if (summary.task !== location.slug) {
      summary.task = location.slug;
    }

    const missing: string[] = [];
    const unattached: string[] = [];
    for (const file of new Set(summary.steps.flatMap((step) => step.files))) {
      if (!allowed(file) || path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) {
        throw new Error(`Plan references a forbidden path: ${file}.`);
      }
      const resolved = await realpath(path.join(repoPath, file)).catch(() => undefined);
      const relative = resolved && path.relative(repoPath, resolved);
      if (resolved && (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))) {
        throw new Error(`Plan references a path outside the project: ${file}.`);
      }
      if (!resolved || !await stat(resolved).then((info) => info.isFile()).catch(() => false)) missing.push(file);
      if (!attachedFiles.some((attached) => attached.replace(/\\/g, '/') === file.replace(/\\/g, '/'))) unattached.push(file);
    }
    const relative = await this.files.savePlan(location, plan, summary);
    const race = buildRace(summary, id, relative, await readPreferences(location.project));
    const changed = await saveRace(this.files, location, race);
    const overlaps = await overlapWarnings(this.files, repoPath, location, race);
    await this.files.log(location.task, 'plan_submitted', { changed, missing, unattached, overlaps });
    const notes = [
      `Plan saved. ${changed.length} handoff${changed.length === 1 ? '' : 's'} regenerated.`,
      missing.length ? `Files not found: ${missing.join(', ')}.` : '',
      unattached.length ? `Files not attached: ${unattached.join(', ')}.` : '',
      overlaps.length ? `Overlapping open tasks: ${overlaps.join('; ')}.` : '',
    ].filter(Boolean);
    return { notice: notes.join(' '), changed, summary };
  }

  async saveStepSummary(repoPath: string, id: string, stepId: string, summaryText: string): Promise<{
    completed: boolean; readySteps: string[]; allDone: boolean; stepSummaries: Record<string, string>;
  }> {
    const location = await this.files.findTask(repoPath, id);
    if (!location) throw new Error('Task is not in this project.');
    const state = await this.files.state(location.task);
    if (TerminalStates.has(state.status)) throw new Error('Closed tasks are read-only. Create a linked follow-up task.');

    await this.files.saveStepSummary(location.task, stepId, summaryText);
    const race = await this.files.readRace(location.task);
    const savedList = await this.files.listStepSummaries(location.task);
    const stepSummaries: Record<string, string> = {};
    for (const item of savedList) {
      stepSummaries[item.step_id] = item.summary;
    }

    const readySteps: string[] = [];
    let allDone = false;
    if (race) {
      for (const step of race.steps) {
        const hasDependenciesMet = step.depends_on.every((dep) => Boolean(stepSummaries[dep]));
        if (hasDependenciesMet) {
          readySteps.push(step.id);
        }
      }
      allDone = race.steps.every((step) => Boolean(stepSummaries[step.id]));
      if (allDone) {
        await this.files.transition(location.task, 'done', 'All step summaries completed');
      }
    }
    return { completed: true, readySteps, allDone, stepSummaries };
  }

  async inspectSession(repoPath: string, id: string): Promise<{ state: string; prompt?: string; nextAction: string;
    race?: RaceMap & { prompts: Record<string, string> };
    stepSummaries?: Record<string, string>;
    readySteps?: string[];
  } | undefined> {
    const location = await this.files.findTask(repoPath, id);
    if (!location) return undefined;
    const state = await this.files.state(location.task);
    const prompt = state.status === 'awaiting_plan'
      ? await readFile(path.join(location.task, 'planning_prompt.md'), 'utf8').catch(() => undefined) : undefined;
    const listed = (await this.files.listTasks(repoPath)).find((task) => task.id === id);
    const race = await this.files.readRace(location.task);
    const savedList = await this.files.listStepSummaries(location.task);
    const stepSummaries: Record<string, string> = {};
    for (const item of savedList) {
      stepSummaries[item.step_id] = item.summary;
    }

    const readySteps: string[] = [];
    if (race) {
      for (const step of race.steps) {
        if (step.depends_on.every((dep) => Boolean(stepSummaries[dep]))) {
          readySteps.push(step.id);
        }
      }
    }

    return {
      state: state.status,
      prompt,
      nextAction: listed?.nextAction ?? '',
      race: race ? { ...race, prompts: Object.fromEntries(race.steps.map((step) =>
        [step.id, handoffText(step, race.plan_file, id)])) } : undefined,
      stepSummaries,
      readySteps,
    };
  }

  async acceptInput(repoPath: string, id: string, message: string): Promise<{ accepted: boolean; reason: string }> {
    const location = await this.files.findTask(repoPath, id);
    if (!location) return { accepted: false, reason: 'Task not found. Create a new task.' };
    const state = await this.files.state(location.task);
    if (TerminalStates.has(state.status)) return { accepted: false, reason: 'This task is closed. Create a linked follow-up task.' };
    const goal = await readFile(path.join(location.task, 'task.md'), 'utf8');
    if (!await checkScope(goal, message)) return { accepted: false, reason: 'This looks like a different task. Create a new task under this project?' };
    await appendFile(path.join(location.task, 'task.md'), `\n## Clarification\n${message.trim()}\n`, 'utf8');
    await this.files.log(location.task, 'user_input', { message });
    return { accepted: true, reason: 'Added to this task. The goal and existing plan remain available.' };
  }
}
