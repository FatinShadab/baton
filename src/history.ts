import { MemoryStore } from './memory';
import { JsonStore } from './store';
import { HistoryMessage, HistoryReply, TaskRecord } from './types';

/** Manual task lifecycle; routing alone never marks work as completed. */
export class TaskHistory {
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly store: JsonStore, private readonly memory: MemoryStore) {}

  async handle(message: HistoryMessage): Promise<HistoryReply> {
    try {
      const notice = message.type === 'loadHistory' ? undefined
        : await this.save(message.taskId, message.type === 'importPlan' ? { plan: message.plan } : { outcome: message.outcome });
      const tasks = await this.store.loadTasks();
      if (!tasks) return { type: 'historyError', message: notice ?? 'Could not load history. Please retry.' };
      return { type: 'history', tasks: tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        notice, changed: message.type !== 'loadHistory' };
    } catch {
      return { type: 'historyError', message: 'Could not load or save history. Please retry.' };
    }
  }

  save(id: string, change: { plan: string } | { outcome: string }): Promise<string> {
    const operation = this.pending.then(async () => {
      const task = await this.store.updateTask(id, (current) => {
        if ('plan' in change) return { ...current, plan: change.plan.trim(),
          status: current.status === 'done' || current.status === 'blocked' ? current.status : 'planned' };
        if (current.status === 'blocked') throw new Error('Blocked tasks cannot be completed.');
        return { ...current, outcome: change.outcome.trim(), status: 'done' };
      });
      if (!task) return 'Could not save this task. Please retry.';
      const kind = 'plan' in change ? 'plan' : 'task';
      const indexed = await this.memory.add({ kind,
        text: kind === 'plan' ? `Task: ${task.text}\nPlan:\n${task.plan}` : this.completedText(task),
        meta: { taskId: task.id, taskText: task.text, risk: task.route.risk_tier, tier: task.routerTier },
      });
      return indexed ? (kind === 'plan' ? 'Plan imported and added to memory.' : 'Completed task saved to memory.')
        : 'Task saved, but memory could not be saved. Retry to add it to search.';
    }).catch(() => 'Could not save this task. Please retry.');
    this.pending = operation;
    return operation;
  }

  private completedText(task: TaskRecord): string {
    return [`Task: ${task.text}`, `Decision: ${task.decision}`, `Reason: ${task.route.reason}`,
      task.outcome ? `Outcome: ${task.outcome}` : 'Status: done'].join('\n');
  }
}
