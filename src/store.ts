import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SessionRecord, SessionRecordSchema, TaskRecord, TaskRecordSchema } from './types';
import { StatsRecordSchema, StatsRecord } from './types'; export const StatsSchema = z.array(StatsRecordSchema);
import { DEFAULT_ROUTER_SETTINGS, RouterSettings, RouterSettingsSchema } from './router/settings';

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
    await vscode.workspace.fs.createDirectory(this.root);
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

  private enqueue<T>(operation: () => Promise<T>): Promise<T | undefined> {
    const result = this.pending.then(operation).catch(() => {
      void vscode.window.showErrorMessage('Baton could not read or save local memory. Check storage access and JSON data.');
      return undefined;
    });
    this.pending = result;
    return result;
  }

  read<T>(name: string, schema: z.ZodType<T>, fallback: T): Promise<T | undefined> {
    return this.enqueue(() => this.readFile(name, schema, fallback));
  }

  async write<T>(name: string, schema: z.ZodType<T>, value: T): Promise<boolean> {
    return (await this.enqueue(async () => {
      await this.writeFile(name, schema, value);
      return true;
    })) === true;
  }

  async append<T>(name: string, schema: z.ZodType<T>, value: T): Promise<boolean> {
    return (await this.enqueue(async () => {
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
    return this.enqueue(async () => {
      const tasks = await this.readFile('tasks.json', TasksSchema, []);
      const index = tasks.findIndex((task) => task.id === id);
      if (index < 0) throw new Error('Task not found');
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
      title: title || 'New session',
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
    return this.enqueue(async () => {
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
    return this.enqueue(async () => {
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

  /** Load availability info from global storage */
  async loadAvailability(): Promise<{ globalStorageUri: { fsPath: string } }> {
    const vscode = require('vscode') as typeof import('vscode');
    // Use globalStorageUri from workspace if available, otherwise empty
    const storageUri = (vscode.workspace as any).globalStorageUri;
    const fsPath = storageUri?.fsPath || '';
    return { globalStorageUri: { fsPath } };
  }
}
