import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SessionRecord, SessionRecordSchema, TaskRecord, TaskRecordSchema, UserAgentConfig, UserAgentConfigSchema } from './types';
import { StatsRecordSchema, StatsRecord } from './types'; export const StatsSchema = z.array(StatsRecordSchema);
import { DEFAULT_ROUTER_SETTINGS, RouterSettings, RouterSettingsSchema } from './router/settings';
import { TaskOutputChunk } from './task-output';

export const DEFAULT_USER_AGENTS: UserAgentConfig[] = [
  {
    id: 'claude-architect',
    name: 'Claude Architect',
    type: 'web',
    models: 'claude-3-7-sonnet',
    color: 'purple',
    githubAttached: true,
    url: 'https://claude.ai/new',
    capabilities: ['planning', 'architecture', 'uncertainty'],
    enabled: true,
  },
  {
    id: 'codex-cli',
    name: 'Codex CLI',
    type: 'local',
    models: 'codex-cli, gpt-4o',
    color: 'cyan',
    githubAttached: false,
    capabilities: ['coding', 'terminal', 'cli', 'execution'],
    enabled: true,
  },
  {
    id: 'gemini-researcher',
    name: 'Gemini Researcher',
    type: 'web',
    models: 'gemini-2.5-pro',
    color: 'emerald',
    githubAttached: true,
    url: 'https://gemini.google.com/app',
    capabilities: ['research', 'planning', 'analysis'],
    enabled: true,
  },
];

const UserAgentsSchema = z.array(UserAgentConfigSchema);
const TasksSchema = z.array(TaskRecordSchema);
const SessionsSchema = z.array(SessionRecordSchema);

/** Use one instance per activation to serialize local memory operations. */
export class JsonStore {
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly root: vscode.Uri) {}

  private file(name: string): vscode.Uri {
    if (!/^[a-z][a-z0-9-]*\.json$/i.test(name) || /^credentials/i.test(name)) {
      throw new Error('Invalid store filename');
    }
    return vscode.Uri.joinPath(this.root, name);
  }

  private async readFile<T>(name: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
    const file = this.file(name);
    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(file);
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return fallback;
      throw error;
    }
    return schema.parse(JSON.parse(Buffer.from(bytes).toString('utf8')));
  }

  private async writeFile<T>(name: string, schema: z.ZodType<T>, value: T): Promise<void> {
    const file = this.file(name);
    const bytes = Buffer.from(JSON.stringify(schema.parse(value), null, 2), 'utf8');
    await vscode.workspace.fs.createDirectory(this.root);
    const temporary = vscode.Uri.joinPath(this.root, `${name}.tmp`);
    await vscode.workspace.fs.writeFile(temporary, bytes);
    await vscode.workspace.fs.rename(temporary, file, { overwrite: true });
  }

  private enqueue<T>(name: string, action: 'read' | 'write', operation: () => Promise<T>): Promise<T | undefined> {
    const result = this.pending.then(operation).catch((error: unknown) => {
      const reason = error instanceof z.ZodError
        ? `Data does not match the current format at ${error.issues[0]?.path.join('.') || 'root'}.`
        : error instanceof SyntaxError ? 'The JSON is invalid.'
          : error instanceof vscode.FileSystemError ? `Storage error: ${error.code}.`
            : 'See the Extension Host log for details.';
      console.error(`Baton failed to ${action} ${name}:`, error);
      void vscode.window.showErrorMessage(`Baton could not ${action} ${name}. ${reason}`);
      return undefined;
    });
    this.pending = result;
    return result;
  }

  read<T>(name: string, schema: z.ZodType<T>, fallback: T): Promise<T | undefined> {
    return this.enqueue(name, 'read', () => this.readFile(name, schema, fallback));
  }

  async write<T>(name: string, schema: z.ZodType<T>, value: T): Promise<boolean> {
    return (await this.enqueue(name, 'write', async () => {
      await this.writeFile(name, schema, value);
      return true;
    })) === true;
  }

  async append<T>(name: string, schema: z.ZodType<T>, value: T): Promise<boolean> {
    return (await this.enqueue(name, 'write', async () => {
      const listSchema = z.array(schema);
      const items = await this.readFile(name, listSchema, []);
      items.push(schema.parse(value));
      await this.writeFile(name, listSchema, items);
      return true;
    })) === true;
  }

  loadTasks(): Promise<TaskRecord[] | undefined> {
    return this.read('tasks.json', TasksSchema, []);
  }

  saveTasks(tasks: TaskRecord[]): Promise<boolean> {
    return this.write('tasks.json', TasksSchema, tasks);
  }

  appendTask(task: TaskRecord): Promise<boolean> {
    return this.append('tasks.json', TaskRecordSchema, task);
  }

  updateTask(id: string, update: (task: TaskRecord) => TaskRecord): Promise<TaskRecord | undefined> {
    return this.enqueue('tasks.json', 'write', async () => {
      const tasks = await this.readFile('tasks.json', TasksSchema, []);
      const index = tasks.findIndex((task) => task.id === id);
      if (index < 0) return undefined;
      tasks[index] = TaskRecordSchema.parse(update(tasks[index]));
      await this.writeFile('tasks.json', TasksSchema, tasks);
      return tasks[index];
    });
  }

  loadSessions(): Promise<SessionRecord[] | undefined> {
    return this.read('sessions.json', SessionsSchema, []);
  }

  saveSessions(sessions: SessionRecord[]): Promise<boolean> {
    return this.write('sessions.json', SessionsSchema, sessions);
  }

  async getSession(id: string): Promise<SessionRecord | undefined> {
    const sessions = await this.loadSessions();
    return sessions?.find((session) => session.id === id);
  }

  async createSession(title?: string, workspaceUri?: string): Promise<SessionRecord> {
    const session: SessionRecord = {
      id: randomUUID(),
      title: title || 'New race session',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      workspaceUri,
      taskIds: [],
      turns: [],
    };
    await this.append('sessions.json', SessionRecordSchema, session);
    return session;
  }

  updateSession(id: string, update: (session: SessionRecord) => SessionRecord): Promise<SessionRecord | undefined> {
    return this.enqueue('sessions.json', 'write', async () => {
      const sessions = await this.readFile('sessions.json', SessionsSchema, []);
      const index = sessions.findIndex((session) => session.id === id);
      if (index < 0) return undefined;
      sessions[index] = SessionRecordSchema.parse(update(sessions[index]));
      sessions[index].updatedAt = new Date().toISOString();
      await this.writeFile('sessions.json', SessionsSchema, sessions);
      return sessions[index];
    });
  }

  deleteSession(id: string): Promise<boolean> {
    return this.enqueue('sessions.json', 'write', async () => {
      const sessions = await this.readFile('sessions.json', SessionsSchema, []);
      const filtered = sessions.filter((session) => session.id !== id);
      if (filtered.length === sessions.length) return false;
      await this.writeFile('sessions.json', SessionsSchema, filtered);
      return true;
    }).then((res) => res ?? false);
  }

  /** Load stats from global storage */
  async loadStats(): Promise<StatsRecord[]> {
    try {
      const raw = await this.readFile('stats.json', StatsSchema, []);
      return raw;
    } catch {
      return [];
    }
  }

  /** Save stats to global storage */
  async saveStats(stats: StatsRecord[]): Promise<boolean> {
    return this.write('stats.json', StatsSchema, stats);
  }

  loadRouterSettings(): Promise<RouterSettings | undefined> {
    return this.read('router-settings.json', RouterSettingsSchema, DEFAULT_ROUTER_SETTINGS);
  }

  saveRouterSettings(settings: RouterSettings): Promise<boolean> {
    return this.write('router-settings.json', RouterSettingsSchema, settings);
  }

  async loadUserAgents(): Promise<UserAgentConfig[]> {
    const list = await this.read('user-agents.json', UserAgentsSchema, DEFAULT_USER_AGENTS);
    return list && list.length > 0 ? list : DEFAULT_USER_AGENTS;
  }

  saveUserAgents(agents: UserAgentConfig[]): Promise<boolean> {
    return this.write('user-agents.json', UserAgentsSchema, agents);
  }

  /** Load availability info from global storage */
  async loadAvailability(): Promise<{ globalStorageUri: { fsPath: string } }> {
    const vscode = require('vscode') as typeof import('vscode');
    // Use globalStorageUri from workspace if available, otherwise empty
    const storageUri = (vscode.workspace as any).globalStorageUri;
    const fsPath = storageUri?.fsPath || '';
    return { globalStorageUri: { fsPath } };
  }

  private readonly outputBuffers = new Map<string, TaskOutputChunk[]>();

  getTaskOutputBuffer(taskId: string): TaskOutputChunk[] {
    return [...(this.outputBuffers.get(taskId) ?? [])];
  }

  appendTaskOutput(chunk: TaskOutputChunk): void {
    if (!this.outputBuffers.has(chunk.task_id)) {
      this.outputBuffers.set(chunk.task_id, []);
    }
    this.outputBuffers.get(chunk.task_id)!.push(chunk);
  }

  setTaskOutputBuffer(taskId: string, chunks: TaskOutputChunk[]): void {
    this.outputBuffers.set(taskId, [...chunks]);
  }
}
