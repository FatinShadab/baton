import * as vscode from 'vscode';
import { importDevelopmentKeys, setKeys } from './secrets';
import { JsonStore } from './store';
import { configureRouter, initializeRouter } from './router';
import { DEFAULT_ROUTER_SETTINGS } from './router/settings';
import { initializeMemory, MemoryStore } from './memory';
import { TaskHistory } from './history';
import { initVoice } from './voice';
import { CodexRunner } from './codex';
import { copyMcpConfig, registerMcpProvider } from './mcp/config';
import { McpSession } from './mcp/session';
import { registerKbCommands } from './kb/store';
import { registerResearchCommand } from './kb/research';
import { registerSourceCommands } from './kb/fetch';
import { maybeRunDailyUpdate, registerUpdateCommand } from './kb/update';
import { SessionViewProvider } from './session-view';
import { BatonEditorPanel } from './editor-panel';
import { currentProjectFolder } from './project';
import { TaskFlow } from './task-flow';
import { migrateLegacyTasks } from './task-migration';

export async function activate(context: vscode.ExtensionContext): Promise<{ store: JsonStore; memory: MemoryStore }> {
  await importDevelopmentKeys(context);
  const store = new JsonStore(context.globalStorageUri);
  const taskFlow = new TaskFlow(context.globalStorageUri.fsPath, context.extensionUri.fsPath);
  await migrateLegacyTasks(store, taskFlow).catch(() => 0);
  configureRouter((await store.loadRouterSettings()) ?? DEFAULT_ROUTER_SETTINGS);
  context.subscriptions.push(initializeRouter(context.secrets));
  const memory = initializeMemory(store);
  const history = new TaskHistory(store, memory);
  const codex = new CodexRunner(store, history, context);
  const mcp = new McpSession(context);

  initVoice(context.secrets);
  registerMcpProvider(context);

  const openEditor = async (sessionId?: string) => {
    const panel = await BatonEditorPanel.createOrShow(
      context.extensionUri,
      store,
      history,
      codex,
      mcp,
      context.secrets,
      taskFlow,
      () => {
        sessionProvider.setActiveSessionId(BatonEditorPanel.currentPanel?.getActiveSessionId());
        void sessionProvider.refresh();
      },
      sessionId,
    );
    if (!sessionId) await panel.refreshProjectState();
    sessionProvider.setActiveSessionId(panel.getActiveSessionId());
    return panel;
  };

  const newSession = async () => {
    const folder = currentProjectFolder();
    if (!folder) {
      const choice = await vscode.window.showInformationMessage(
        'Please open or create a project folder first before creating tasks.',
        'Open Project',
      );
      if (choice === 'Open Project') {
        await vscode.commands.executeCommand('vscode.openFolder');
      }
      return;
    }
    const alreadyOpen = Boolean(BatonEditorPanel.currentPanel);
    const panel = await BatonEditorPanel.createOrShow(
      context.extensionUri,
      store,
      history,
      codex,
      mcp,
      context.secrets,
      taskFlow,
      () => {
        sessionProvider.setActiveSessionId(BatonEditorPanel.currentPanel?.getActiveSessionId());
        void sessionProvider.refresh();
      },
    );
    if (alreadyOpen) await panel.startNewSession();
    sessionProvider.setActiveSessionId(panel.getActiveSessionId());
    await sessionProvider.refresh();
  };

  const sessionProvider = new SessionViewProvider(
    context.extensionUri,
    store,
    async (sessionId: string) => {
      await openEditor(sessionId);
    },
    async () => {
      await newSession();
    },
    context.secrets,
    mcp,
    context,
    taskFlow,
  );

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = '$(sparkle) Baton';
  statusBar.tooltip = 'Open Baton Chat & Router Panel';
  statusBar.command = 'baton.openEditor';
  statusBar.show();

  context.subscriptions.push(
    codex,
    mcp,
    statusBar,
    initializeRouter(context.secrets, context),
    vscode.commands.registerCommand('baton.openEditor', openEditor),
    vscode.commands.registerCommand('baton.newSession', newSession),
    vscode.commands.registerCommand('baton.setKeys', () => setKeys(context.secrets)),
    vscode.commands.registerCommand('baton.copyMcpConfig', () => copyMcpConfig(context)),
    ...registerKbCommands(context),
    ...registerResearchCommand(context),
    ...registerSourceCommands(context),
    ...registerUpdateCommand(context),
    vscode.commands.registerCommand('baton.focus', async () => {
      try {
        await vscode.commands.executeCommand('baton.sessions.focus');
      } catch {
        try {
          await vscode.commands.executeCommand('baton.panel.focus');
        } catch {
          void vscode.window.showErrorMessage('Baton could not open the sidebar. Please try again.');
        }
      }
    }),
    vscode.window.registerWebviewViewProvider(SessionViewProvider.viewType, sessionProvider),
    vscode.window.registerWebviewViewProvider('baton.panel', sessionProvider), // Fallback alias
  );

  void maybeRunDailyUpdate(context);

  const editorListener = vscode.window.onDidChangeActiveTextEditor(() => {
    sessionProvider.refresh().catch(() => {});
    BatonEditorPanel.currentPanel?.refreshProjectState().catch(() => {});
  });
  const workspaceListener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
    sessionProvider.refresh().catch(() => {});
    BatonEditorPanel.currentPanel?.refreshProjectState().catch(() => {});
  });

  context.subscriptions.push(editorListener, workspaceListener);

  return { store, memory };
}
