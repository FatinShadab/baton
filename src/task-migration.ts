import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { JsonStore } from './store';
import { TaskFlow } from './task-flow';
import { SessionRecord, TaskRecord } from './types';

/** Preserve legacy records while moving each old task into its own project session. */
export async function migrateLegacyTasks(store: JsonStore, flow: TaskFlow): Promise<number> {
  const tasks = await store.loadTasks();
  const sessions = await store.loadSessions();
  if (!tasks || !sessions) return 0;
  const replacements = new Map<string, string>();
  const updated: TaskRecord[] = [];
  for (const task of tasks) {
    if (task.taskFolder) { updated.push(task); continue; }
    let repoPath: string;
    try {
      const uri = task.workspaceUri ? vscode.Uri.parse(task.workspaceUri)
        : vscode.workspace.workspaceFolders?.find((folder) => folder.uri.scheme === 'file')?.uri;
      if (!uri) { updated.push(task); continue; }
      if (uri.scheme !== 'file') { updated.push(task); continue; }
      repoPath = uri.fsPath;
    } catch { updated.push(task); continue; }
    try {
      const location = await flow.files.createTask(repoPath, task.text);
      if (task.plan) {
        await writeFile(path.join(location.task, 'plans', 'legacy-plan.md'), task.plan, 'utf8');
      }
      await writeFile(path.join(location.task, 'planning_prompt.md'),
        `Review the saved task and any legacy plan in plans/legacy-plan.md. Return a plan ending in the BATON summary block with task: ${location.slug}, steps, risks, and matching Markdown plan_ref headings.`, 'utf8');
      if (task.status === 'done') await flow.files.transition(location.task, 'done', 'Migrated completed task');
      else if (task.status === 'running') await flow.files.transition(location.task, 'running', 'Migrated running task');
      else if (task.status === 'blocked') await flow.files.transition(location.task, 'abandoned', 'Migrated blocked task');
      else await flow.files.transition(location.task, 'awaiting_plan', 'Migrated legacy task; submit a BATON summary');
      replacements.set(task.id, location.id);
      updated.push({ ...task, id: location.id, taskFolder: location.task, workspaceUri: vscode.Uri.file(repoPath).toString(),
        flowStatus: task.status === 'done' ? 'done' : task.status === 'running' ? 'running'
          : task.status === 'blocked' ? 'abandoned' : 'awaiting_plan' });
    } catch { updated.push(task); }
  }
  if (!replacements.size) return 0;
  const split: SessionRecord[] = [];
  for (const session of sessions) {
    const ids = (session.taskIds ?? []).map((id) => replacements.get(id) ?? id);
    if (ids.length <= 1) {
      split.push({ ...session, taskIds: ids, turns: session.turns?.map((turn) => ({ ...turn,
        taskId: turn.taskId ? replacements.get(turn.taskId) ?? turn.taskId : undefined })) });
      continue;
    }
    for (const [index, id] of ids.entries()) {
      const task = updated.find((entry) => entry.id === id);
      split.push({ ...session, id: index === 0 ? session.id : randomUUID(),
        title: task?.text.slice(0, 60) ?? session.title, taskIds: [id],
        turns: session.turns?.filter((turn) => turn.taskId === (tasks.find((entry) => (replacements.get(entry.id) ?? entry.id) === id)?.id))
          .map((turn) => ({ ...turn, taskId: id })) });
    }
  }
  const linked = new Set(split.flatMap((session) => session.taskIds ?? []));
  for (const task of updated) {
    if (!task.taskFolder || linked.has(task.id)) continue;
    split.push({ id: randomUUID(), title: task.text.slice(0, 60), createdAt: task.createdAt,
      updatedAt: task.createdAt, workspaceUri: task.workspaceUri, taskIds: [task.id],
      turns: [
        { id: randomUUID(), role: 'user', content: task.text, createdAt: task.createdAt, taskId: task.id },
        { id: randomUUID(), role: 'assistant', content: task.route.reason, createdAt: task.createdAt,
          taskId: task.id, route: task.route, decision: task.decision, routerTier: task.routerTier,
          status: task.status, plan: task.plan, outcome: task.outcome },
      ] });
  }
  if (!await store.saveTasks(updated)) return 0;
  await store.saveSessions(split);
  return replacements.size;
}
