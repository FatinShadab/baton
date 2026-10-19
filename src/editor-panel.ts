import * as vscode from 'vscode';
import { randomBytes, randomUUID } from 'node:crypto';
import { clearPersonalKey, personalKeyStatus, savePersonalKey } from './secrets';
import { JsonStore } from './store';
import { routeTask } from './router';
import { decide } from './policy';
import {
  ExtensionMessage,
  isHandoffMessage,
  isHistoryMessage,
  isPanelMessage,
  isTaskActionMessage,
  isVoiceMessage,
  SessionRecord,
} from './types';
import { buildContext, BuiltContext, MAX_CONTEXT_CHARS, selectContext } from './context';
import { TaskHistory } from './history';
import { handoffAvailability, openExternalHandoff, planExternal, readClipboard } from './handoff';
import { VoiceRecorderSession, startVoiceRecorderServer, transcribe } from './voice';
import { openIntegratedBrowser } from './browser';
import { CodexRunner } from './codex';
import { codexAvailable } from './terminal';
import { copyMcpConfig, serverOptions } from './mcp/config';
import { McpSession } from './mcp/session';
import { ensureMcpAgentInstructions } from './mcp/agents';
import { discoverResources } from './resources';
import { currentProject, sameProject } from './project';

export class BatonEditorPanel {
  public static currentPanel: BatonEditorPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private activeSession?: SessionRecord;
  private recorderSession?: VoiceRecorderSession;
  private preview?: { requestId: number; text: string; context: BuiltContext };
  private latestPreview = 0;
  private lastRouted?: { taskId: string; text: string; snippet: string };

  public static async createOrShow(
    extensionUri: vscode.Uri,
    store: JsonStore,
    history: TaskHistory,
    codex: CodexRunner,
    mcp: McpSession,
    secrets: vscode.SecretStorage,
    onSessionUpdated?: () => void,
    sessionId?: string,
  ): Promise<BatonEditorPanel> {
    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Active : vscode.ViewColumn.One;

    if (BatonEditorPanel.currentPanel) {
      BatonEditorPanel.currentPanel.panel.reveal(column);
      if (sessionId) {
        await BatonEditorPanel.currentPanel.loadSession(sessionId);
      }
      return BatonEditorPanel.currentPanel;
    }

    const mediaRoot = vscode.Uri.joinPath(extensionUri, 'media');
    const panel = vscode.window.createWebviewPanel(
      'baton.editor',
      'Baton',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [mediaRoot],
      },
    );

    panel.iconPath = vscode.Uri.joinPath(mediaRoot, 'baton.svg');

    BatonEditorPanel.currentPanel = new BatonEditorPanel(
      panel,
      extensionUri,
      store,
      history,
      codex,
      mcp,
      secrets,
      onSessionUpdated,
    );

    await BatonEditorPanel.currentPanel.init(sessionId);
    return BatonEditorPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly store: JsonStore,
    private readonly history: TaskHistory,
    private readonly codex: CodexRunner,
    private readonly mcp: McpSession,
    private readonly secrets: vscode.SecretStorage,
    private readonly onSessionUpdated?: () => void,
  ) {
    this.panel = panel;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (message: unknown) => this.handleMessage(message),
      null,
      this.disposables,
    );
  }

  public getActiveSessionId(): string | undefined {
    return this.activeSession?.id;
  }

  public async loadSession(sessionId: string): Promise<void> {
    const project = this.historyProject();
    if (!project) {
      this.activeSession = undefined;
      this.onSessionUpdated?.();
      await this.postMessage({ type: 'projectState', hasProject: false });
      return;
    }
    const session = await this.store.getSession(sessionId);
    if (!session || !sameProject(session.workspaceUri, project.uri)) return;
    this.activeSession = session;
    this.onSessionUpdated?.();
    this.panel.title = `Baton · ${session.title.slice(0, 20)}`;
    const allTasks = (await this.store.loadTasks()) ?? [];
    const tasks = allTasks.filter((t) => session.taskIds?.includes(t.id) && sameProject(t.workspaceUri, project.uri));
    await this.postMessage({
      type: 'projectState',
      hasProject: true,
      projectName: project.name,
      projectUri: project.uri,
    });
    await this.postMessage({
      type: 'activeSession',
      session,
      tasks,
    });
  }

  public async startNewSession(): Promise<void> {
    const project = this.historyProject();
    if (!project) {
      this.activeSession = undefined;
      this.onSessionUpdated?.();
      await this.postMessage({ type: 'projectState', hasProject: false });
      return;
    }
    const session = await this.store.createSession('New task', project.uri);
    this.activeSession = session;
    this.panel.title = 'Baton · New task';
    this.onSessionUpdated?.();
    await this.postMessage({
      type: 'projectState',
      hasProject: true,
      projectName: project.name,
      projectUri: project.uri,
    });
    await this.postMessage({
      type: 'activeSession',
      session,
      tasks: [],
    });
  }

  public async refreshProjectState(): Promise<void> {
    const project = this.historyProject();
    if (!project) {
      this.activeSession = undefined;
      this.onSessionUpdated?.();
      await this.postMessage({ type: 'projectState', hasProject: false });
    } else {
      await this.postMessage({
        type: 'projectState',
        hasProject: true,
        projectName: project.name,
        projectUri: project.uri,
      });
      if (!sameProject(this.activeSession?.workspaceUri, project.uri)) {
        const sessions = (await this.store.loadSessions()) ?? [];
        const latest = sessions.filter((session) => sameProject(session.workspaceUri, project.uri))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
        if (latest) await this.loadSession(latest.id);
        else await this.startNewSession();
      }
    }
  }

  private async init(sessionId?: string): Promise<void> {
    await this.renderHtml();
    const project = this.historyProject();
    if (!project) {
      await this.postMessage({ type: 'projectState', hasProject: false });
      return;
    }
    if (sessionId) {
      await this.loadSession(sessionId);
    } else {
      await this.startNewSession();
    }
  }

  private async postMessage(message: unknown): Promise<void> {
    try {
      await this.panel.webview.postMessage(message);
    } catch {
      // Panel disposed
    }
  }

  private availableDestinations = async () => ({
    ...handoffAvailability(),
    codex: await codexAvailable(
      vscode.workspace.workspaceFolders?.find((folder) => folder.uri.scheme === 'file')?.uri.fsPath ?? process.cwd(),
    ),
  });

  private historyProject(): { uri: string; name: string } | undefined {
    return currentProject();
  }

  private async refreshHistory(): Promise<void> {
    try {
      await this.postMessage(await this.history.handle({ type: 'loadHistory' }, this.historyProject()));
    } catch {
      // closed
    }
  }

  private parseVoiceIntent(raw: string): { text: string; autoRoute: boolean } {
    const trimmed = raw.trim();
    const startsWithRoute = /^route\s+/i.test(trimmed);
    const endsWithGo = /\s+go\.?$/i.test(trimmed);
    let text = trimmed;
    if (startsWithRoute) text = text.replace(/^route\s+/i, '');
    else if (endsWithGo) text = text.replace(/\s+go\.?$/i, '');
    return { text: text.trim(), autoRoute: startsWithRoute || endsWithGo };
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (typeof message === 'object' && message !== null && 'type' in message) {
      if (message.type === 'openProject') {
        await vscode.commands.executeCommand('vscode.openFolder');
        return;
      }
      if (message.type === 'baton.kb.update' || message.type === 'baton.kb.openSources') {
        await vscode.commands.executeCommand(message.type);
        return;
      }
      if (message.type === 'checkProjectState') {
        await this.refreshProjectState();
        return;
      }

      if (message.type === 'newSession') {
        await this.startNewSession();
        return;
      }
      if (message.type === 'switchSession' && 'sessionId' in message && typeof message.sessionId === 'string') {
        await this.loadSession(message.sessionId);
        return;
      }

      if (message.type === 'openExternalUrl' && 'url' in message && typeof message.url === 'string') {
        try {
          await vscode.env.openExternal(vscode.Uri.parse(message.url));
        } catch {
          // Open failed
        }
        return;
      }

      if (message.type === 'refreshResources' && 'query' in message && typeof message.query === 'string') {
        const queryText = message.query;
        const tId = 'taskId' in message && typeof message.taskId === 'string' ? message.taskId : randomUUID();
        void (async () => {
          try {
            await this.postMessage({ type: 'resourcesSearching', taskId: tId, query: queryText });
            const resources = await discoverResources(this.secrets, tId, queryText);
            await this.postMessage({ type: 'resourcesReady', resources });
          } catch {
            // Silently fall through
          }
        })();
        return;
      }

      if (message.type === 'personalKeysStatus' || message.type === 'savePersonalKey' || message.type === 'clearPersonalKey') {
        const provider = 'provider' in message && (message.provider === 'gemma' || message.provider === 'elevenlabs')
          ? message.provider : undefined;
        let notice: string | undefined;
        if (message.type === 'savePersonalKey' && provider) {
          const value = 'value' in message && typeof message.value === 'string' ? message.value.trim() : '';
          notice = value && value.length <= 4096 && await savePersonalKey(this.secrets, provider, value)
            ? `${provider === 'gemma' ? 'Gemma' : 'ElevenLabs'} key saved.` : 'Could not save the key.';
        } else if (message.type === 'clearPersonalKey' && provider) {
          notice = await clearPersonalKey(this.secrets, provider)
            ? `${provider === 'gemma' ? 'Gemma' : 'ElevenLabs'} key removed.` : 'Could not remove the key.';
        }
        await this.postMessage({ type: 'personalKeysStatus', configured: await personalKeyStatus(this.secrets), notice });
        return;
      }

      if (message.type === 'mcpToggle' || message.type === 'mcpStatusRequest' || message.type === 'mcpCopyConfig') {
        if (message.type === 'mcpCopyConfig') {
          // copyMcpConfig requires ExtensionContext, handled via command or direct
          await vscode.commands.executeCommand('baton.copyMcpConfig');
          return;
        }
        let notice = message.type === 'mcpToggle' ? (this.mcp.running ? await this.mcp.stop() : await this.mcp.start()) : undefined;
        if (message.type === 'mcpToggle' && this.mcp.running) {
          const instructions = await ensureMcpAgentInstructions();
          if (instructions === 'created') notice += ' Added AGENTS.md to the project root.';
          if (instructions === 'failed') notice += ' Could not add AGENTS.md to the project root.';
        }
        let options;
        try { options = this.mcp.running ? serverOptions({ extensionUri: this.extensionUri } as vscode.ExtensionContext) : undefined; } catch { /* closed */ }
        await this.postMessage({ type: 'mcpStatus', running: this.mcp.running, command: options?.command, endpoint: options?.args[0], notice });
        return;
      }
    }

    if (isTaskActionMessage(message)) {
      const reply = await this.codex.handle(message);
      if (this.activeSession) {
        const tasks = await this.store.loadTasks();
        const updatedTask = tasks?.find((t) => t.id === message.taskId);
        if (updatedTask) {
          await this.store.updateSession(this.activeSession.id, (curr) => ({
            ...curr,
            turns: curr.turns?.map((t) => (t.taskId === message.taskId ? { ...t, status: updatedTask.status, outcome: updatedTask.outcome } : t)),
          }));
          this.activeSession = await this.store.getSession(this.activeSession.id);
        }
      }
      await this.postMessage(reply);
      await this.refreshHistory();
      return;
    }

    if (isHistoryMessage(message)) {
      await this.postMessage(await this.history.handle(message, this.historyProject()));
      return;
    }

    if (isHandoffMessage(message)) {
      try {
        if (message.type === 'readClipboard') {
          const text = await readClipboard();
          await this.postMessage({ type: 'clipboardContent', text });
        } else if (message.type === 'openExternalHandoff') {
          const notice = await openExternalHandoff(message.target);
          await this.postMessage({ type: 'handoffExternalResult', notice });
        } else if (message.type === 'handoffAvailabilityRequest') {
          await this.postMessage({ type: 'handoffAvailability', installed: await this.availableDestinations() });
        } else if (message.type === 'planExternal') {
          let text = this.lastRouted?.taskId === message.taskId ? this.lastRouted.text : '';
          let snippet = this.lastRouted?.taskId === message.taskId ? this.lastRouted.snippet : '';
          if (!text) {
            const tasks = await this.store.loadTasks();
            const task = tasks?.find((entry) => entry.id === message.taskId);
            text = task?.text ?? '';
            snippet = task?.contextSnippet ?? '';
          }
          if (!text) {
            await this.postMessage({ type: 'handoffResult', notice: 'Saved task not found. Refresh History and try again.' });
            return;
          }
          const outcome = await planExternal(message.target, text, snippet);
          await this.postMessage({ type: 'handoffResult', ...outcome });
        } else if (message.type === 'savePlan') {
          const notice = await this.history.save(message.taskId, { plan: message.plan });
          if (this.activeSession) {
            await this.store.updateSession(this.activeSession.id, (curr) => ({
              ...curr,
              turns: curr.turns?.map((t) => (t.taskId === message.taskId ? { ...t, plan: message.plan, status: 'planned' } : t)),
            }));
            this.activeSession = await this.store.getSession(this.activeSession.id);
          }
          await this.postMessage({ type: 'planSaved', taskId: message.taskId, notice });
          await this.refreshHistory();
        }
      } catch {
        await this.postMessage({ type: 'planSaveError', message: 'Handoff action failed. Please try again.' });
      }
      return;
    }

    if (isVoiceMessage(message)) {
      try {
        this.recorderSession?.close();
        this.recorderSession = await startVoiceRecorderServer(async (audioBuffer, mime) => {
          try {
            await this.postMessage({ type: 'voiceTranscribing' });
            const transcript = await transcribe(audioBuffer, mime, this.secrets);
            const { text, autoRoute } = this.parseVoiceIntent(transcript);
            await this.postMessage({ type: 'voiceText', text, autoRoute });
          } catch (err: unknown) {
            const errorMsg = err instanceof Error ? err.message : 'Transcription failed';
            await this.postMessage({ type: 'voiceError', message: errorMsg });
          } finally {
            this.recorderSession = undefined;
          }
        }, (reason) => {
          this.recorderSession = undefined;
          void this.postMessage({ type: 'voiceError', message: reason });
        });
        await openIntegratedBrowser(this.recorderSession.url);
        await this.postMessage({ type: 'voiceRecorderReady' });
      } catch (err: unknown) {
        this.recorderSession?.close();
        this.recorderSession = undefined;
        const errorMsg = err instanceof Error ? err.message : 'Voice recording error';
        await this.postMessage({ type: 'voiceError', message: errorMsg });
      }
      return;
    }

    if (!isPanelMessage(message)) return;

    let reply: ExtensionMessage;
    try {
      if (message.type === 'previewContext') {
        const generation = ++this.latestPreview;
        this.preview = undefined;
        const collected = await buildContext(message.text);
        if (generation !== this.latestPreview) return;
        this.preview = { requestId: message.requestId, text: message.text, context: collected };
        await this.postMessage({
          type: 'contextPreview',
          requestId: message.requestId,
          parts: collected.parts,
          limit: MAX_CONTEXT_CHARS,
        } satisfies ExtensionMessage);
        return;
      }

      let snippet = '';
      let collected: BuiltContext | undefined;
      if (this.preview && this.preview.requestId === message.requestId && this.preview.text === message.text) {
        collected = this.preview.context;
        snippet = selectContext(this.preview.context, message.sources ?? []);
      } else {
        collected = await buildContext(message.text);
        const sources = (message.sources && message.sources.length > 0)
          ? message.sources
          : collected.parts.map((p) => p.source);
        snippet = selectContext(collected, sources);
      }
      const workspaceUri = collected?.workspaceUri ?? this.historyProject()?.uri;
      if (!sameProject(this.activeSession?.workspaceUri, workspaceUri)) await this.refreshProjectState();
      const { route, tier, notice } = await routeTask(message.text, snippet, workspaceUri);
      const decision = decide(route, message.text);
      const taskId = randomUUID();

      const saved = await this.store.appendTask({
        id: taskId,
        createdAt: new Date().toISOString(),
        text: message.text,
        route: decision.route,
        routerTier: tier,
        decision: decision.action,
        // KB routing metadata from the route
        recommended_model: decision.route.recommended_model,
        model_reasoning: decision.route.model_reasoning,
        kb_refs: decision.route.kb_refs,
        kb_stale: decision.route.kb_stale,
        kb_note: decision.route.kb_note,
        workspaceUri,
        contextSnippet: snippet,
        status: decision.action === 'BLOCK' ? 'blocked' : 'routed',
      });

      this.lastRouted = { taskId, text: message.text, snippet };

      // Update current session with this task and turn
      if (this.activeSession) {
        const updatedTitle = (this.activeSession.title === 'New task' || this.activeSession.title === 'New session')
          ? (message.text.length > 30 ? `${message.text.slice(0, 30)}…` : message.text)
          : this.activeSession.title;

        await this.store.updateSession(this.activeSession.id, (curr) => ({
          ...curr,
          title: updatedTitle,
          taskIds: [...(curr.taskIds ?? []), taskId],
          turns: [
            ...(curr.turns ?? []),
            {
              id: randomUUID(),
              role: 'user',
              content: message.text,
              createdAt: new Date().toISOString(),
              taskId,
            },
            {
              id: randomUUID(),
              role: 'assistant',
              content: route.reason,
              createdAt: new Date().toISOString(),
              taskId,
              route,
              decision: decision.action,
              routerTier: tier,
              status: decision.action === 'BLOCK' ? 'blocked' : 'routed',
              contextSnippet: snippet,
              why: decision.why,
              overrode: decision.overrode,
              recommended_model: decision.route.recommended_model,
              model_reasoning: decision.route.model_reasoning,
            },
          ],
        }));

        this.activeSession = await this.store.getSession(this.activeSession.id);
        this.onSessionUpdated?.();
      }

      reply = {
        type: 'routed',
        requestId: message.requestId,
        taskId,
        text: message.text,
        decision,
        tier,
        saved,
        notice,
        contextSnippet: snippet,
        contextParts: collected?.parts,
      };

      // Discover related resources and media asynchronously
      const textToSearch = message.text;
      const snippetForSearch = snippet;
      void (async () => {
        try {
          await this.postMessage({ type: 'resourcesSearching', taskId, query: textToSearch });
          const resources = await discoverResources(this.secrets, taskId, textToSearch, snippetForSearch);
          await this.postMessage({ type: 'resourcesReady', resources });
        } catch {
          // Silently fall through
        }
      })();
    } catch {
      reply = { type: 'routeError', requestId: message.requestId };
    }

    await this.postMessage(reply);
  }

  private async renderHtml(): Promise<void> {
    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, 'media');
    try {
      const template = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(mediaRoot, 'panel.html'));
      const replacements: Record<string, string> = {
        nonce: randomBytes(16).toString('hex'),
        cspSource: this.panel.webview.cspSource,
        scriptUri: this.panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'panel.js')).toString(),
        historyUri: this.panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'history.js')).toString(),
        actionsUri: this.panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'task-actions.js')).toString(),
        resourcesUri: this.panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'resources.js')).toString(),
        styleUri: this.panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'panel.css')).toString(),
        watermarkUri: this.panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'baton-watermark.png')).toString(),
      };
      this.panel.webview.html = Buffer.from(template).toString('utf8').replace(
        /\{\{(\w+)\}\}/g,
        (_, name: string) => replacements[name] ?? '',
      );
    } catch {
      this.panel.webview.html = '<!doctype html><html><body>Baton could not load. Please reload.</body></html>';
    }
  }

  public dispose(): void {
    BatonEditorPanel.currentPanel = undefined;
    if (this.recorderSession) {
      this.recorderSession.close();
      this.recorderSession = undefined;
    }
    this.panel.dispose();
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) disposable.dispose();
    }
  }
}
