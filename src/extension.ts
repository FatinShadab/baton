import * as vscode from 'vscode';
import { randomBytes, randomUUID } from 'node:crypto';
import { setKeys } from './secrets';
import { JsonStore } from './store';
import { initializeRouter, routeTask } from './router';
import { decide } from './policy';
import { ExtensionMessage, isHandoffMessage, isHistoryMessage, isPanelMessage, isTaskActionMessage, isVoiceMessage } from './types';
import { buildContext, BuiltContext, MAX_CONTEXT_CHARS, selectContext } from './context';
import { initializeMemory, MemoryStore } from './memory';
import { TaskHistory } from './history';
import { planExternal, readClipboard } from './handoff';
import { FallbackServerSession, initVoice, startVoiceFallbackServer, transcribe } from './voice';
import { CodexRunner } from './codex';

export function activate(context: vscode.ExtensionContext): { store: JsonStore; memory: MemoryStore } {
  const mediaRoot = vscode.Uri.joinPath(context.extensionUri, 'media');
  const store = new JsonStore(context.globalStorageUri);
  const memory = initializeMemory(store);
  const history = new TaskHistory(store, memory);
  const codex = new CodexRunner(store, history);

  initVoice(context.secrets);

  let activeWebviewView: vscode.WebviewView | undefined;
  let pendingDemoTask: string | undefined;

  const DEMO_TASK = 'Add a rate limiter to the Express API with Redis fallback and migrate user session tokens';

  const sendDemoTask = async (view: vscode.WebviewView, taskText: string) => {
    try {
      await view.webview.postMessage({ type: 'prefillDemo', text: taskText });
    } catch {
      // A closed sidebar can no longer receive messages.
    }
  };

  context.subscriptions.push(
    codex,
    initializeRouter(context.secrets),
    vscode.commands.registerCommand('baton.setKeys', () => setKeys(context.secrets)),
    vscode.commands.registerCommand('baton.focus', async () => {
      try {
        await vscode.commands.executeCommand('baton.panel.focus');
      } catch {
        void vscode.window.showErrorMessage('Baton could not open the sidebar. Please try again.');
      }
    }),
    vscode.commands.registerCommand('baton.demo', async () => {
      try {
        await vscode.commands.executeCommand('baton.panel.focus');
      } catch {
        void vscode.window.showErrorMessage('Baton could not open the sidebar. Please try again.');
      }
      if (activeWebviewView) {
        await sendDemoTask(activeWebviewView, DEMO_TASK);
      } else {
        pendingDemoTask = DEMO_TASK;
      }
    }),
    vscode.window.registerWebviewViewProvider('baton.panel', {
      async resolveWebviewView(view) {
        activeWebviewView = view;
        if (pendingDemoTask) {
          const taskToDeliver = pendingDemoTask;
          pendingDemoTask = undefined;
          setTimeout(() => {
            void sendDemoTask(view, taskToDeliver);
          }, 250);
        }
        view.webview.options = { enableScripts: true, localResourceRoots: [mediaRoot] };
        let preview: { requestId: number; text: string; context: BuiltContext } | undefined;
        let latestPreview = 0;
        let lastRouted: { taskId: string; text: string; snippet: string } | undefined;
        let fallbackSession: FallbackServerSession | undefined;

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
          if (isTaskActionMessage(message)) {
            const reply = await codex.handle(message);
            try {
              await view.webview.postMessage(reply);
              await view.webview.postMessage(await history.handle({ type: 'loadHistory' }));
            } catch { /* A closed sidebar can no longer receive messages. */ }
            return;
          }
          if (isHistoryMessage(message)) {
            try {
              await view.webview.postMessage(await history.handle(message));
            } catch { /* A closed sidebar can no longer receive messages. */ }
            return;
          }
          if (isHandoffMessage(message)) {
            try {
              if (message.type === 'readClipboard') {
                const text = await readClipboard();
                await view.webview.postMessage({ type: 'clipboardContent', text });
              } else if (message.type === 'planExternal') {
                let text = lastRouted?.taskId === message.taskId ? lastRouted.text : '';
                const snippet = lastRouted?.taskId === message.taskId ? lastRouted.snippet : '';
                if (!text) {
                  const tasks = await store.loadTasks();
                  text = tasks?.find((t) => t.id === message.taskId)?.text ?? '';
                }
                await planExternal(message.target, text, snippet);
              } else if (message.type === 'savePlan') {
                const notice = await history.save(message.taskId, { plan: message.plan });
                await view.webview.postMessage({ type: 'planSaved', taskId: message.taskId, notice });
                await view.webview.postMessage(await history.handle({ type: 'loadHistory' }));
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
              if (message.type === 'voiceAudio') {
                const buffer = Buffer.from(message.audioBase64, 'base64');
                const transcript = await transcribe(buffer, message.mime, context.secrets);
                const { text, autoRoute } = parseVoiceIntent(transcript);
                await view.webview.postMessage({ type: 'voiceText', text, autoRoute });
              } else if (message.type === 'startVoiceFallback') {
                if (fallbackSession) {
                  fallbackSession.close();
                  fallbackSession = undefined;
                }
                fallbackSession = await startVoiceFallbackServer(async (audioBuffer, mime) => {
                  try {
                    const transcript = await transcribe(audioBuffer, mime, context.secrets);
                    const { text, autoRoute } = parseVoiceIntent(transcript);
                    await view.webview.postMessage({ type: 'voiceText', text, autoRoute });
                  } catch (err: unknown) {
                    const errorMsg = err instanceof Error ? err.message : 'Transcription failed';
                    await view.webview.postMessage({ type: 'voiceError', message: errorMsg });
                  }
                });
                await vscode.env.openExternal(vscode.Uri.parse(fallbackSession.url));
                void vscode.window.showInformationMessage('Recording in your browser, close the tab when done.');
              }
            } catch (err: unknown) {
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
            const { route, tier } = await routeTask(message.text, snippet);
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
            reply = { type: 'routed', requestId: message.requestId, taskId, text: message.text, decision, tier, saved };
          } catch {
            reply = { type: 'routeError', requestId: message.requestId };
          }
          try {
            await view.webview.postMessage(reply);
          } catch {
            // A closed sidebar can no longer receive messages.
          }
        });
        view.onDidDispose(() => {
          if (activeWebviewView === view) {
            activeWebviewView = undefined;
          }
          listener.dispose();
          if (fallbackSession) {
            fallbackSession.close();
            fallbackSession = undefined;
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
