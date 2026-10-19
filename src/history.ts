import { MemoryStore } from './memory';
import { JsonStore } from './store';
import { HistoryMessage, HistoryReply, TaskRecord, StatsRecord } from './types';

/** Manual task lifecycle; routing alone never marks work as completed. */
export class TaskHistory {
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly store: JsonStore, private readonly memory: MemoryStore) {}

  async handle(message: HistoryMessage, project?: { uri: string; name: string }): Promise<HistoryReply> {
    try {
      if (message.type === 'importPlan') {
        const tasks = await this.store.loadTasks();
        if (!tasks?.some((task) => task.id === message.taskId && this.inProject(task, project?.uri))) {
          return { type: 'historyError', message: 'This task is not in the current project. Refresh History.' };
        }
      }
      const notice = message.type === 'loadHistory' ? undefined
        : await this.save(message.taskId, { plan: message.plan });
      const tasks = await this.store.loadTasks();
      if (!tasks) return { type: 'historyError', message: notice ?? 'Could not load history. Please retry.' };
      return { type: 'history', tasks: tasks.filter((task) => this.inProject(task, project?.uri))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        notice, changed: message.type !== 'loadHistory', projectName: project?.name };
    } catch {
      return { type: 'historyError', message: 'Could not load or save history. Please retry.' };
    }
  }

  private inProject(task: TaskRecord, workspaceUri?: string): boolean {
    if (!task.workspaceUri || !workspaceUri) return false;
    return process.platform === 'win32'
      ? task.workspaceUri.toLowerCase() === workspaceUri.toLowerCase()
      : task.workspaceUri === workspaceUri;
  }

  private async recordOutcome(task: TaskRecord, outcome: 'Passed' | 'Failed' | 'Partial'): Promise<void> {
    const stats = await this.store.loadStats();
    const agentId = task.route.recommended_destination || 'unknown';
    const taskType = task.route.task_type || 'unknown';
    const model = task.recommended_model ?? task.route.recommended_model ?? null;
    const existing = stats.find((s) => s.agent_id === agentId && s.taskType === taskType && s.model === model);
    let updated;
    if (existing) {
      const newTotal = existing.total + 1;
      const newSuccess = outcome === 'Passed' ? existing.success + 1 : outcome === 'Partial' ? existing.success + 0.5 : existing.success;
      updated = stats.map((entry) => entry === existing ? { ...existing, total: newTotal, success: newSuccess } : entry);
    } else {
      const newSuccess = outcome === 'Passed' ? 1 : outcome === 'Partial' ? 0.5 : 0;
      updated = [...stats, { agent_id: agentId, model, taskType, total: 1, success: newSuccess }];
    }
    await this.store.saveStats(updated);
  }

  save(id: string, change: { plan: string } | { outcome: 'Passed' | 'Failed' | 'Partial'; changedFiles?: string[] }): Promise<string> {
    const operation = this.pending.then(async () => {
      const task = await this.store.updateTask(id, (current) => {
        if ('plan' in change) return { ...current, plan: change.plan.trim(),
          status: ['done', 'blocked', 'running'].includes(current.status) ? current.status : 'planned' };
        if (current.status === 'blocked') throw new Error('Blocked tasks cannot be completed.');
        return { ...current, outcome: change.outcome, changedFiles: change.changedFiles, status: 'done' };
      });
      if (!task) return 'Could not save this task. Please retry.';
      const kind = 'plan' in change ? 'plan' : 'task';
      const indexed = await this.memory.add({ kind,
        text: kind === 'plan' ? `Task: ${task.text}\nPlan:\n${task.plan}` : this.completedText(task),
        meta: { taskId: task.id, taskText: task.text, risk: task.route.risk_tier, tier: task.routerTier,
          workspaceUri: task.workspaceUri,
          ...(kind === 'task' ? { outcome: task.outcome, changedFiles: task.changedFiles } : {}) },
      });
      // Record outcome in stats
      if ('outcome' in change) await this.recordOutcome(task, change.outcome);
      return indexed ? (kind === 'plan' ? 'Plan imported and added to memory.' : 'Completed task saved to memory.')
        : 'Task saved, but memory could not be saved. Retry to add it to search.';
    }).catch(() => 'Could not save this task. Please retry.');
    this.pending = operation;
    return operation;
  }

  private completedText(task: TaskRecord): string {
    const parts = [`Task: ${task.text}`, `Decision: ${task.decision}`, `Reason: ${task.route.reason}`,
      task.outcome ? `Outcome: ${task.outcome}` : 'Status: done',
      task.changedFiles ? `Changed files:\n${task.changedFiles.join('\n') || '(none)'}` : 'Changed files: unavailable'];
    // Add model and reasoning if available
    if (task.recommended_model) {
      parts.push(`Model: ${task.recommended_model}`);
    }
    if (task.model_reasoning) {
      parts.push(`Reasoning: ${task.model_reasoning}`);
    }
    return parts.join('\n');
  }
}
