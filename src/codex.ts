import * as vscode from 'vscode';
import { readFile, realpath } from 'node:fs/promises';
import * as path from 'node:path';
import { allowed, gitPathspecs, MAX_CONTEXT_CHARS, safeFile } from './context';
import { TaskHistory } from './history';
import { decide } from './policy';
import { JsonStore } from './store';
import { BatonTerminals, capture, codexAvailable, preparePrompt } from './terminal';
import { TaskActionMessage, TaskActionReply, TaskRecord } from './types';
import { loadAvailability, KbContext } from './kb/store';

export function buildCodexPrompt(task: TaskRecord): string {
  return ['Implement the following coding task in this workspace.',
    'Do not read or send .env, *.pem, *.key, id_rsa*, credentials*, node_modules, or .git contents.',
    '', '## Task', task.text,
    ...(task.plan?.trim() ? ['', '## Saved plan', task.plan] : []),
    ...(task.contextSnippet?.trim() ? ['', '## Project context', task.contextSnippet.slice(0, MAX_CONTEXT_CHARS)] : []),
  ].join('\n');
}

/** Verified with `codex exec --help`: --model exists; no reasoning flag is shown. */
export const CodexCapabilities = {
  supportsModelFlag: true,
  supportsReasoningFlag: false,
};

function requireRunnable(task: TaskRecord): 'RUN' | 'CONFIRM' {
  if (task.flowStatus && !['race_ready'].includes(task.flowStatus)) {
    throw new Error(task.flowStatus === 'awaiting_plan' ? 'Paste and save the plan before running this task.'
      : 'This task is not ready to run.');
  }
  if (task.route.recommended_destination === 'antigravity' || task.route.recommended_destination === 'copilot') {
    throw new Error('This agent has no Baton run adapter. Open its prompt manually.');
  }
  const action = decide(task.route, [task.text, task.plan ?? ''].join('\n')).action;
  if (!['RUN', 'CONFIRM'].includes(task.decision) || !['RUN', 'CONFIRM'].includes(action)
    || task.status === 'blocked') throw new Error('Policy does not permit running this task in Codex.');
  if (task.status === 'running') throw new Error('This task is already running. Review it and choose Mark done.');
  if (task.status === 'done') throw new Error('This task is complete. Route a new task to run more work.');
  // A saved confirmation requirement is never lowered by a later policy evaluation.
  return task.decision === 'CONFIRM' || action === 'CONFIRM' ? 'CONFIRM' : 'RUN';
}

export class CodexRunner implements vscode.Disposable {
  private readonly pending = new Set<string>();
  private readonly terminals = new BatonTerminals();

  constructor(private readonly store: JsonStore, private readonly history: TaskHistory,
    private readonly kbContext: KbContext) {}

  async handle(message: TaskActionMessage): Promise<TaskActionReply> {
    let notice: string;
    if (this.pending.has(message.taskId)) {
      return { type: 'taskActionResult', taskId: message.taskId, notice: 'An action is already in progress for this task.' };
    }
    this.pending.add(message.taskId);
    try {
      const task = await this.load(message.taskId);
      if (task.status === 'done' && message.type !== 'showDiff') {
        throw new Error('Closed tasks are read-only. Create a linked follow-up task.');
      }
      switch (message.type) {
        case 'runCodex': notice = await this.run(task); break;
        case 'markDone': notice = await this.markDone(task); break;
        case 'showDiff':
          await vscode.commands.executeCommand('workbench.view.scm');
          notice = 'Opened Source Control to review changes.';
          break;
        case 'runTests': notice = await this.runTests(task); break;
      }
    } catch (error) {
      notice = error instanceof Error ? error.message : 'Baton could not finish this action. Please retry.';
    } finally { this.pending.delete(message.taskId); }
    return { type: 'taskActionResult', taskId: message.taskId, notice };
  }

  private async load(id: string): Promise<TaskRecord> {
    const task = (await this.store.loadTasks())?.find((entry) => entry.id === id);
    if (!task) throw new Error('Could not find the saved task. Refresh History and try again.');
    if (task.taskFolder) {
      try {
        const state = JSON.parse(await readFile(path.join(task.taskFolder, 'state.json'), 'utf8')) as { status?: string };
        if (state.status) task.flowStatus = state.status;
      } catch { throw new Error('Could not load task state. Reopen this task before running it.'); }
    }
    return task;
  }

  private async workspace(task: TaskRecord): Promise<vscode.Uri | undefined> {
    const folders = vscode.workspace.workspaceFolders?.filter((folder) => folder.uri.scheme === 'file') ?? [];
    if (task.workspaceUri) {
      const saved = vscode.Uri.parse(task.workspaceUri);
      const equal = (uri: vscode.Uri) => process.platform === 'win32'
        ? uri.toString().toLowerCase() === saved.toString().toLowerCase() : uri.toString() === saved.toString();
      const folder = folders.find((entry) => equal(entry.uri));
      if (!folder) {
        throw new Error('Reopen this task’s saved workspace before running workspace actions.');
      }
      return folder.uri;
    }
    if (!folders.length) throw new Error('Open a local workspace folder first.');
    if (folders.length === 1) return folders[0].uri;
    const selected = await vscode.window.showQuickPick(folders.map((folder) => ({
      label: folder.name, description: folder.uri.fsPath, uri: folder.uri,
    })), { placeHolder: 'Choose the workspace for this saved task' });
    return selected?.uri;
  }

  private async run(task: TaskRecord): Promise<string> {
    const action = requireRunnable(task);
    if (!vscode.workspace.isTrusted) return 'Trust this workspace before running Codex.';
    const workspace = await this.workspace(task);
    if (!workspace) return 'Run cancelled.';
    if (!await codexAvailable(workspace.fsPath)) {
      const choice = await vscode.window.showInformationMessage(
        'Codex CLI is unavailable. Install it with: npm install -g @openai/codex', 'Copy prompt instead');
      if (choice === 'Copy prompt instead') {
        await vscode.env.clipboard.writeText(buildCodexPrompt(await this.load(task.id)));
        return 'Prompt copied. Install Codex and sign in before retrying.';
      }
      return 'Codex was not started.';
    }
    if (action === 'CONFIRM') {
      const choice = await vscode.window.showWarningMessage(
        `Baton will let Codex edit files in ${workspace.fsPath}. Continue?`, { modal: true },
        { title: 'Run' }, { title: 'Cancel', isCloseAffordance: true });
      if (choice?.title !== 'Run') return 'Run cancelled.';
    }
    // Reload after the modal so a newly imported plan cannot bypass the policy gate.
    const latest = await this.load(task.id);
    const latestAction = requireRunnable(latest);
    if (latestAction === 'CONFIRM' && action !== 'CONFIRM') return 'The task now needs confirmation. Choose Run in Codex again.';
    const requestedModel = latest.recommended_model ?? latest.route.recommended_model;
    let model: string | undefined;
    if (requestedModel) {
      try {
        const availability = await loadAvailability(this.kbContext);
        if (CodexCapabilities.supportsModelFlag && availability.models.some((entry) =>
          entry.agent_id === 'codex' && entry.kind === 'model'
          && entry.name.toLowerCase() === requestedModel.toLowerCase())) {
          model = requestedModel;
        } else {
          void vscode.window.showInformationMessage(`Select model ${requestedModel} manually in Codex.`);
        }
      } catch {
        void vscode.window.showInformationMessage(`Select model ${requestedModel} manually in Codex.`);
      }
    }
    if (latest.model_reasoning || latest.route.model_reasoning) {
      void vscode.window.showInformationMessage(`Select reasoning ${latest.model_reasoning ?? latest.route.model_reasoning} manually in Codex.`);
    }
    const prepared = await preparePrompt(buildCodexPrompt(latest), model);
    const previousStatus = latest.status;
    try {
      const saved = await this.store.updateTask(task.id, (current) => {
        requireRunnable(current);
        if (current.plan !== latest.plan) throw new Error('Plan changed before launch. Please retry.');
        return { ...current, workspaceUri: workspace.toString(), status: 'running',
          approvals: action === 'CONFIRM'
            ? [...(current.approvals ?? []), { approvedAt: new Date().toISOString(), workspaceUri: workspace.toString() }]
            : current.approvals };
      });
      if (!saved) throw new Error('Could not save the run and approval. Codex was not started.');
      try {
        await this.terminals.open('Baton: Codex', workspace, prepared.command, prepared.cleanup);
      } catch {
        await this.store.updateTask(task.id, (current) => ({ ...current,
          status: current.status === 'running' ? previousStatus : current.status }));
        throw new Error('Could not launch Codex. Check the terminal and try again.');
      }
      return 'Codex is running. Review its changes, then choose Mark done.';
    } catch (error) {
      await prepared.cleanup();
      throw error;
    }
  }

  private async markDone(task: TaskRecord): Promise<string> {
    if (task.status === 'blocked') return 'Blocked tasks cannot be completed.';
    const outcome = await vscode.window.showQuickPick(['Passed', 'Failed', 'Partial'],
      { placeHolder: 'What was the outcome of this task?' });
    if (outcome !== 'Passed' && outcome !== 'Failed' && outcome !== 'Partial') return 'Completion cancelled.';
    let changedFiles: string[] | undefined;
    let notice = '';
    try {
      const workspace = await this.workspace(task);
      if (!workspace) return 'Completion cancelled.';
      if (!task.workspaceUri && !await this.store.updateTask(task.id, (current) => ({
        ...current, workspaceUri: workspace.toString(),
      }))) return 'Could not save the workspace. Please retry.';
      const output = await capture('git', ['diff', '--name-only', '-z', '--no-ext-diff', '--no-textconv',
        '--no-renames', '--', ...gitPathspecs()], workspace.fsPath);
      changedFiles = [...new Set(output.split('\0').filter((file) => file && allowed(file)))];
    } catch {
      notice = ' Changed files could not be captured; Git or the saved workspace is unavailable.';
    }
    return await this.history.save(task.id, { outcome, changedFiles }) + notice;
  }

  private async runTests(task: TaskRecord): Promise<string> {
    if (!vscode.workspace.isTrusted) return 'Trust this workspace before running tests.';
    const workspace = await this.workspace(task);
    if (!workspace) return 'Test run cancelled.';
    const root = await realpath(workspace.fsPath);
    const manifest = await safeFile(path.join(root, 'package.json'), root);
    if (!manifest) return 'No readable package.json was found in this workspace root.';
    let data: { scripts?: { test?: unknown } };
    try {
      data = JSON.parse(await readFile(manifest, { encoding: 'utf8', signal: AbortSignal.timeout(5000) }));
      if (typeof data?.scripts?.test !== 'string' || !data.scripts.test.trim()) return 'This workspace has no scripts.test in package.json.';
    } catch { return 'Could not read a valid package.json from this workspace.'; }
    const command = process.platform === 'win32'
      ? "$ErrorActionPreference = 'Stop'; npm.cmd test; exit $LASTEXITCODE" : 'npm test';
    await this.terminals.open('Baton: Tests', workspace, command);
    return 'Running npm test. Review the result before choosing Mark done.';
  }

  dispose(): void { this.terminals.dispose(); }
}
