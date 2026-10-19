import * as vscode from 'vscode';
import { randomBytes, randomUUID } from 'node:crypto';
import { clearPersonalKey, importDevelopmentKeys, personalKeyStatus, savePersonalKey, setKeys } from './secrets';
import { JsonStore } from './store';
import { initializeRouter, routeTask } from './router';
import { decide } from './policy';
import { ExtensionMessage, isHandoffMessage, isHistoryMessage, isPanelMessage, isTaskActionMessage, isVoiceMessage } from './types';
import { buildContext, BuiltContext, MAX_CONTEXT_CHARS, selectContext } from './context';
import { initializeMemory, MemoryStore } from './memory';
import { TaskHistory } from './history';
import { handoffAvailability, openExternalHandoff, planExternal, readClipboard } from './handoff';
import { VoiceRecorderSession, initVoice, startVoiceRecorderServer, transcribe } from './voice';
import { openIntegratedBrowser } from './browser';
import { CodexRunner } from './codex';
import { codexAvailable } from './terminal';
import { copyMcpConfig, registerMcpProvider, serverOptions } from './mcp/config';
import { McpSession } from './mcp/session';
import { ensureMcpAgentInstructions } from './mcp/agents';

export async function activate(context: vscode.ExtensionContext): Promise<{ store: JsonStore; memory: MemoryStore }> {
  await importDevelopmentKeys(context);
  const mediaRoot = vscode.Uri.joinPath(context.extensionUri, 'media');
  const store = new JsonStore(context.globalStorageUri);
  const memory = initializeMemory(store);
  const history = new TaskHistory(store, memory);
  const codex = new CodexRunner(store, history);
  const mcp = new McpSession(context);

  const availableDestinations = async () => ({
    ...handoffAvailability(),
    codex: await codexAvailable(vscode.workspace.workspaceFolders?.find((folder) => folder.uri.scheme === 'file')?.uri.fsPath ?? process.cwd()),
  });

  initVoice(context.secrets);
  registerMcpProvider(context);

  const historyProject = (): { uri: string; name: string } | undefined => {
    const editor = vscode.window.activeTextEditor;
    const folder = (editor && vscode.workspace.getWorkspaceFolder(editor.document.uri))
      ?? vscode.workspace.workspaceFolders?.find((entry) => entry.uri.scheme === 'file');
    return folder?.uri.scheme === 'file' ? { uri: folder.uri.toString(), name: folder.name } : undefined;
  };

  context.subscriptions.push(
    codex,
    mcp,
    initializeRouter(context.secrets),
    vscode.commands.registerCommand('baton.setKeys', () => setKeys(context.secrets)),
    vscode.commands.registerCommand('baton.copyMcpConfig', () => copyMcpConfig(context)),
    vscode.commands.registerCommand('baton.focus', async () => {
      try {
        await vscode.commands.executeCommand('baton.panel.focus');
      } catch {
        void vscode.window.showErrorMessage('Baton could not open the sidebar. Please try again.');
      }
    }),
    vscode.window.registerWebviewViewProvider('baton.panel', {
      async resolveWebviewView(view) {
        view.webview.options = { enableScripts: true, localResourceRoots: [mediaRoot] };
        let preview: { requestId: number; text: string; context: BuiltContext } | undefined;
        let latestPreview = 0;
        let lastRouted: { taskId: string; text: string; snippet: string } | undefined;
        let recorderSession: VoiceRecorderSession | undefined;
        const refreshHistory = async () => {
          try {
            await view.webview.postMessage(await history.handle({ type: 'loadHistory' }, historyProject()));
          } catch { /* A closed sidebar can no longer receive messages. */ }
        };

        const parseVoiceIntent = (raw: string): { text: string; autoRoute: boolean } => {
          const trimmed = raw.trim();
          const startsWithRoute = /^route\s+/i.test(trimmed);
          const endsWithGo = /\s+go\.?$/i.test(trimmed);
          let text = trimmed;
          if (startsWithRoute) text = text.replace(/^route\s+/i, '');
          else if (endsWithGo) text = text.replace(/\s+go\.?$/i, '');
          return { text: text.trim(), autoRoute: startsWithRoute || endsWithGo };
        };

        const listener = view.webview.onDidReceiveMessage(async (message: unknown) => {
          if (typeof message === 'object' && message !== null && 'type' in message
            && (message.type === 'personalKeysStatus' || message.type === 'savePersonalKey' || message.type === 'clearPersonalKey')) {
            const provider = 'provider' in message && (message.provider === 'gemma' || message.provider === 'elevenlabs')
              ? message.provider : undefined;
            let notice: string | undefined;
            if (message.type === 'savePersonalKey' && provider) {
              const value = 'value' in message && typeof message.value === 'string' ? message.value.trim() : '';
              notice = value && value.length <= 4096 && await savePersonalKey(context.secrets, provider, value)
                ? `${provider === 'gemma' ? 'Gemma' : 'ElevenLabs'} key saved.` : 'Could not save the key.';
            } else if (message.type === 'clearPersonalKey' && provider) {
              notice = await clearPersonalKey(context.secrets, provider)
                ? `${provider === 'gemma' ? 'Gemma' : 'ElevenLabs'} key removed.` : 'Could not remove the key.';
            }
            try {
              await view.webview.postMessage({ type: 'personalKeysStatus', configured: await personalKeyStatus(context.secrets), notice });
            } catch { /* A closed sidebar can no longer receive messages. */ }
            return;
          }
          if (typeof message === 'object' && message !== null && 'type' in message
            && (message.type === 'mcpToggle' || message.type === 'mcpStatusRequest' || message.type === 'mcpCopyConfig')) {
            if (message.type === 'mcpCopyConfig') {
              await copyMcpConfig(context);
              return;
            }
            let notice = message.type === 'mcpToggle' ? (mcp.running ? await mcp.stop() : await mcp.start()) : undefined;
            if (message.type === 'mcpToggle' && mcp.running) {
              const instructions = await ensureMcpAgentInstructions();
              if (instructions === 'created') notice += ' Added AGENTS.md to the project root.';
              if (instructions === 'failed') notice += ' Could not add AGENTS.md to the project root.';
            }
            let options;
            try { options = mcp.running ? serverOptions(context) : undefined; } catch { /* Workspace closed. */ }
            try { await view.webview.postMessage({ type: 'mcpStatus', running: mcp.running, command: options?.command, endpoint: options?.args[0], notice }); } catch { /* closed */ }
            return;
          }
          if (isTaskActionMessage(message)) {
            const reply = await codex.handle(message);
            try {
              await view.webview.postMessage(reply);
              await refreshHistory();
            } catch { /* A closed sidebar can no longer receive messages. */ }
            return;
          }
          if (isHistoryMessage(message)) {
            try {
              await view.webview.postMessage(await history.handle(message, historyProject()));
            } catch { /* A closed sidebar can no longer receive messages. */ }
            return;
          }
          if (isHandoffMessage(message)) {
            try {
              if (message.type === 'readClipboard') {
                const text = await readClipboard();
                await view.webview.postMessage({ type: 'clipboardContent', text });
              } else if (message.type === 'openExternalHandoff') {
                const notice = await openExternalHandoff(message.target);
                await view.webview.postMessage({ type: 'handoffExternalResult', notice });
              } else if (message.type === 'handoffAvailabilityRequest') {
                await view.webview.postMessage({ type: 'handoffAvailability', installed: await availableDestinations() });
              } else if (message.type === 'planExternal') {
                let text = lastRouted?.taskId === message.taskId ? lastRouted.text : '';
                let snippet = lastRouted?.taskId === message.taskId ? lastRouted.snippet : '';
                if (!text) {
                  const tasks = await store.loadTasks();
                  const task = tasks?.find((entry) => entry.id === message.taskId);
                  text = task?.text ?? '';
                  snippet = task?.contextSnippet ?? '';
                }
                if (!text) {
                  await view.webview.postMessage({ type: 'handoffResult', notice: 'Saved task not found. Refresh History and try again.' });
                  return;
                }
                const outcome = await planExternal(message.target, text, snippet);
                await view.webview.postMessage({ type: 'handoffResult', ...outcome });
              } else if (message.type === 'savePlan') {
                const notice = await history.save(message.taskId, { plan: message.plan });
                await view.webview.postMessage({ type: 'planSaved', taskId: message.taskId, notice });
                await refreshHistory();
              }
            } catch {
              try {
                await view.webview.postMessage({ type: 'planSaveError', message: 'Handoff action failed. Please try again.' });
              } catch { /* closed */ }
            }
            return;
          }
          if (isVoiceMessage(message)) {
            try {
              recorderSession?.close();
              recorderSession = await startVoiceRecorderServer(async (audioBuffer, mime) => {
                try {
                  await view.webview.postMessage({ type: 'voiceTranscribing' });
                  const transcript = await transcribe(audioBuffer, mime, context.secrets);
                  const { text, autoRoute } = parseVoiceIntent(transcript);
                  await view.webview.postMessage({ type: 'voiceText', text, autoRoute });
                } catch (err: unknown) {
                  const errorMsg = err instanceof Error ? err.message : 'Transcription failed';
                  await view.webview.postMessage({ type: 'voiceError', message: errorMsg });
                } finally {
                  recorderSession = undefined;
                }
              }, (reason) => {
                recorderSession = undefined;
                void view.webview.postMessage({ type: 'voiceError', message: reason });
              });
              await openIntegratedBrowser(recorderSession.url);
              await view.webview.postMessage({ type: 'voiceRecorderReady' });
            } catch (err: unknown) {
              recorderSession?.close();
              recorderSession = undefined;
              const errorMsg = err instanceof Error ? err.message : 'Voice recording error';
              await view.webview.postMessage({ type: 'voiceError', message: errorMsg });
            }
            return;
          }
          if (!isPanelMessage(message)) return;
          let reply: ExtensionMessage;
          try {
            if (message.type === 'previewContext') {
              const generation = ++latestPreview;
              preview = undefined;
              const collected = await buildContext(message.text);
              if (generation !== latestPreview) return;
              preview = { requestId: message.requestId, text: message.text, context: collected };
              await view.webview.postMessage({ type: 'contextPreview', requestId: message.requestId,
                parts: collected.parts, limit: MAX_CONTEXT_CHARS } satisfies ExtensionMessage);
              return;
            }
            if (!preview || preview.requestId !== message.requestId || preview.text !== message.text) {
              throw new Error('Prepare a context preview before routing.');
            }
            const snippet = selectContext(preview.context, message.sources);
            const workspaceUri = preview.context.workspaceUri;
            const { route, tier, notice } = await routeTask(message.text, snippet, workspaceUri);
            const decision = decide(route, message.text);
            const taskId = randomUUID();
            const saved = await store.appendTask({
              id: taskId,
              createdAt: new Date().toISOString(),
              text: message.text,
              route: decision.route,
              routerTier: tier,
              decision: decision.action,
              workspaceUri,
              contextSnippet: snippet,
              status: decision.action === 'BLOCK' ? 'blocked' : 'routed',
            });
            lastRouted = { taskId, text: message.text, snippet };
            reply = { type: 'routed', requestId: message.requestId, taskId, text: message.text, decision, tier, saved, notice };
          } catch {
            reply = { type: 'routeError', requestId: message.requestId };
          }
          try {
            await view.webview.postMessage(reply);
          } catch {
            // A closed sidebar can no longer receive messages.
          }
        });
        const extensionListener = vscode.extensions.onDidChange(() => {
          void availableDestinations().then(async (installed) => {
            try { await view.webview.postMessage({ type: 'handoffAvailability', installed }); } catch { /* closed */ }
          }, () => { /* closed */ });
        });
        const editorListener = vscode.window.onDidChangeActiveTextEditor(() => { void refreshHistory(); });
        const workspaceListener = vscode.workspace.onDidChangeWorkspaceFolders(() => { void refreshHistory(); });
        view.onDidDispose(() => {
          listener.dispose();
          extensionListener.dispose();
          editorListener.dispose();
          workspaceListener.dispose();
          if (recorderSession) {
            recorderSession.close();
            recorderSession = undefined;
          }
        });

        try {
          const template = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(mediaRoot, 'panel.html'));
          const replacements: Record<string, string> = {
            nonce: randomBytes(16).toString('hex'),
            cspSource: view.webview.cspSource,
            scriptUri: view.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'panel.js')).toString(),
            historyUri: view.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'history.js')).toString(),
            actionsUri: view.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'task-actions.js')).toString(),
            styleUri: view.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'panel.css')).toString(),
          };
          view.webview.html = Buffer.from(template).toString('utf8').replace(
            /\{\{(\w+)\}\}/g, (_, name: string) => replacements[name] ?? '',
          );
        } catch {
          view.webview.html = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'"></head><body>Baton could not load. Please reload the window.</body></html>';
        }
      },
    }),
  );
  return { store, memory };
}
