import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { TaskFiles } from './task-files';

export interface TaskOutputChunk {
  project_id: string;
  task_id: string;
  run_id: string;
  chunk: string;
  stream: 'stdout' | 'stderr' | 'status';
  timestamp: string;
}

export type TaskOutputListener = (chunk: TaskOutputChunk) => void;

export class TaskOutputManager {
  private readonly buffers = new Map<string, TaskOutputChunk[]>();
  private readonly listeners = new Set<TaskOutputListener>();

  constructor(private readonly files?: TaskFiles) {}

  getBuffer(taskId: string): TaskOutputChunk[] {
    return [...(this.buffers.get(taskId) ?? [])];
  }

  setBuffer(taskId: string, chunks: TaskOutputChunk[]): void {
    this.buffers.set(taskId, [...chunks]);
  }

  async appendChunk(
    projectId: string,
    taskId: string,
    runId: string,
    chunk: string,
    stream: 'stdout' | 'stderr' | 'status' = 'stdout',
    taskFolder?: string,
  ): Promise<TaskOutputChunk> {
    const outputChunk: TaskOutputChunk = {
      project_id: projectId,
      task_id: taskId,
      run_id: runId,
      chunk,
      stream,
      timestamp: new Date().toISOString(),
    };

    if (!this.buffers.has(taskId)) {
      this.buffers.set(taskId, []);
    }
    this.buffers.get(taskId)!.push(outputChunk);

    if (taskFolder && this.files) {
      await this.files.log(taskFolder, 'output', {
        project_id: projectId,
        task_id: taskId,
        run_id: runId,
        chunk,
        stream,
      });
    }

    for (const listener of this.listeners) {
      try {
        listener(outputChunk);
      } catch {
        // Listener error must not fail output pipeline
      }
    }

    return outputChunk;
  }

  async loadFromLog(taskFolder: string, projectId?: string, taskId?: string): Promise<TaskOutputChunk[]> {
    const logPath = path.join(taskFolder, 'log.jsonl');
    const content = await readFile(logPath, 'utf8').catch(() => '');
    const chunks: TaskOutputChunk[] = [];
    const inferredTaskId = taskId ?? path.basename(taskFolder).split('_')[0];
    const inferredProjectId = projectId ?? path.basename(path.dirname(path.dirname(taskFolder)));

    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.event === 'output' && typeof parsed.chunk === 'string') {
          chunks.push({
            project_id: parsed.project_id || inferredProjectId,
            task_id: parsed.task_id || inferredTaskId,
            run_id: parsed.run_id || 'default',
            chunk: parsed.chunk,
            stream: parsed.stream || 'stdout',
            timestamp: parsed.at || new Date().toISOString(),
          });
        }
      } catch {
        // Ignore unparseable lines
      }
    }
    this.buffers.set(inferredTaskId, chunks);
    return chunks;
  }

  subscribe(listener: TaskOutputListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/**
 * Handles UI-side session output filtering and active task buffer rendering.
 * Ensures chunks from non-active tasks are buffered in memory and never rendered in the active view.
 */
export class SessionViewOutputRouter {
  private activeTaskId?: string;
  private renderedOutputs: TaskOutputChunk[] = [];
  private unsubscribe?: () => void;

  constructor(private readonly manager: TaskOutputManager) {
    this.unsubscribe = this.manager.subscribe((chunk) => {
      // Ignore any event whose task_id does not match the active view destination
      if (!this.activeTaskId || chunk.task_id !== this.activeTaskId) {
        return;
      }
      this.renderedOutputs.push(chunk);
    });
  }

  setActiveTask(taskId: string | undefined): void {
    this.activeTaskId = taskId;
    if (taskId) {
      this.renderedOutputs = this.manager.getBuffer(taskId);
    } else {
      this.renderedOutputs = [];
    }
  }

  getActiveTaskId(): string | undefined {
    return this.activeTaskId;
  }

  getRenderedOutput(): TaskOutputChunk[] {
    return [...this.renderedOutputs];
  }

  dispose(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
    this.renderedOutputs = [];
  }
}
