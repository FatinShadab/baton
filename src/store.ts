import * as vscode from 'vscode';
import { z } from 'zod';
import { TaskRecord, TaskRecordSchema } from './types';

const TasksSchema = z.array(TaskRecordSchema);

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
}
