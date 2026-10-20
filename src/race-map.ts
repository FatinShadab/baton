import { readFile, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { PlanStep, PlanSummary, RaceMap } from './task-model';
import { TaskFiles, TaskLocation } from './task-files';

const PREFERENCES: Record<PlanStep['type'], Record<PlanStep['complexity'], [string, string]>> = {
  code: { low: ['codex', 'gpt-6.1-sol'], med: ['codex', 'gpt-6.1-sol'], high: ['codex', 'gpt-6-astra'] },
  refactor: { low: ['codex', 'gpt-6.1-sol'], med: ['codex', 'gpt-6.1-sol'], high: ['codex', 'gpt-6-astra'] },
  test: { low: ['codex', 'gpt-6.1-sol'], med: ['codex', 'gpt-6.1-sol'], high: ['codex', 'gpt-6-astra'] },
  docs: { low: ['copilot', 'Auto'], med: ['codex', 'gpt-6.1-sol'], high: ['codex', 'gpt-6.1-sol'] },
  research: { low: ['antigravity', 'gemini-4-argon'], med: ['antigravity', 'gemini-4-argon'], high: ['antigravity', 'gemini-4-argon'] },
  review: { low: ['codex', 'gpt-6.1-sol'], med: ['codex', 'gpt-6-astra'], high: ['codex', 'gpt-6-astra'] },
};

export type PreferenceOverrides = Partial<Record<`${PlanStep['type']}.${PlanStep['complexity']}`, [string, string]>>;

export async function readPreferences(project: string): Promise<PreferenceOverrides> {
  const source = await readFile(path.join(project, 'project.md'), 'utf8').catch(() => '');
  const overrides: PreferenceOverrides = {};
  for (const line of source.split(/\r?\n/)) {
    const match = /^- (code|refactor|test|docs|research|review)\.(low|med|high): ([a-z_]+)\/([\w.-]+)$/.exec(line.trim());
    if (match) overrides[`${match[1]}.${match[2]}` as keyof PreferenceOverrides] = [match[3], match[4]];
  }
  return overrides;
}

export function orderSteps(steps: PlanStep[]): string[][] {
  const remaining = new Map(steps.map((step) => [step.id, step]));
  const completed = new Set<string>();
  const groups: string[][] = [];
  while (remaining.size) {
    const ready = [...remaining.values()].filter((step) => step.depends_on.every((id) => completed.has(id)));
    if (!ready.length) throw new Error('Dependency cycle in race map.');
    const first = ready[0].parallel_group;
    const batch = ready.filter((step) => step.parallel_group === first).map((step) => step.id);
    groups.push(batch);
    for (const id of batch) { remaining.delete(id); completed.add(id); }
  }
  return groups;
}

export function buildRace(summary: PlanSummary, id: string, planFile?: string, preferences: PreferenceOverrides = {}): RaceMap {
  return {
    task_id: id, plan_file: planFile,
    steps: summary.steps.map((step, index) => {
      const [agent, model] = preferences[`${step.type}.${step.complexity}`] ?? PREFERENCES[step.type][step.complexity];
      return { ...step, agent, model, handoff: `handoffs/H${index + 1}.md` };
    }),
    groups: orderSteps(summary.steps),
  };
}

export function handoffText(step: RaceMap['steps'][number], planFile?: string, taskId?: string): string {
  const upstreamRefs = step.depends_on.length
    ? `\nUpstream summaries: ${step.depends_on.map((dep) => `baton_get_step_summary('${taskId || 'task'}', '${dep}')`).join(', ')}`
    : '';
  return `# ${step.id}: ${step.title}\n\nAgent: ${step.agent}\nModel: ${step.model ?? 'default'}\nPlan: ${planFile ?? '(single-step task)'}\nPlan section: ${step.plan_ref}\nDepends on: ${step.depends_on.join(', ') || '(none)'}${upstreamRefs}\nParallel group: ${step.parallel_group}\nFiles: ${step.files.join(', ') || '(none)'}\nAcceptance: ${step.acceptance}\n\nRead the plan section from disk before executing.\n`;
}

export async function saveRace(files: TaskFiles, location: TaskLocation, race: RaceMap): Promise<string[]> {
  const old = await files.readRace(location.task);
  const changed: string[] = [];
  for (const step of race.steps) {
    const previous = old?.steps.find((item) => item.id === step.id);
    const oldText = previous && handoffText(previous, old?.plan_file, race.task_id);
    const newText = handoffText(step, race.plan_file, race.task_id);
    if (oldText === newText) continue;
    await writeFile(path.join(location.task, step.handoff), newText, 'utf8');
    changed.push(step.handoff);
  }
  const currentPaths = new Set(race.steps.map((step) => step.handoff));
  for (const previous of old?.steps ?? []) {
    if (currentPaths.has(previous.handoff) || !/^handoffs\/H\d+\.md$/.test(previous.handoff.replace(/\\/g, '/'))) continue;
    await unlink(path.join(location.task, previous.handoff)).catch(() => undefined);
    changed.push(previous.handoff);
  }
  await files.writeRace(location.task, race);
  await files.transition(location.task, 'race_ready', 'Race map and handoffs ready');
  return changed;
}

export async function overlapWarnings(files: TaskFiles, repoPath: string, location: TaskLocation, race: RaceMap): Promise<string[]> {
  const warnings: string[] = [];
  const targetFiles = new Set(race.steps.flatMap((step) => step.files));
  for (const other of await files.listTasks(repoPath)) {
    if (other.id === location.id || other.state === 'done' || other.state === 'abandoned') continue;
    const otherRace = await files.readRace(other.task);
    const overlap = otherRace?.steps.flatMap((step) => step.files).filter((file) => targetFiles.has(file)) ?? [];
    if (overlap.length) warnings.push(`${other.slug}: ${[...new Set(overlap)].join(', ')}`);
  }
  return warnings;
}
