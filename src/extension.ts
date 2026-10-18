import * as vscode from 'vscode';
import { randomBytes, randomUUID } from 'node:crypto';
import { setKeys } from './secrets';
import { JsonStore } from './store';
import { initializeRouter, routeTask } from './router';
import { decide } from './policy';
import { ExtensionMessage, isHistoryMessage, isPanelMessage } from './types';
import { buildContext, BuiltContext, MAX_CONTEXT_CHARS, selectContext } from './context';
import { initializeMemory, MemoryStore } from './memory';
import { TaskHistory } from './history';

export function activate(context: vscode.ExtensionContext): { store: JsonStore; memory: MemoryStore } {
  const mediaRoot = vscode.Uri.joinPath(context.extensionUri, 'media');
  const store = new JsonStore(context.globalStorageUri);
  const memory = initializeMemory(store);
  const history = new TaskHistory(store, memory);

  context.subscriptions.push(
    initializeRouter(context.secrets),
    vscode.commands.registerCommand('baton.setKeys', () => setKeys(context.secrets)),
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
        const listener = view.webview.onDidReceiveMessage(async (message: unknown) => {
          if (isHistoryMessage(message)) {
            try {
              await view.webview.postMessage(await history.handle(message));
            } catch { /* A closed sidebar can no longer receive messages. */ }
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
            const { route, tier } = await routeTask(message.text, snippet);
            const decision = decide(route, message.text);
            const saved = await store.appendTask({
              id: randomUUID(),
              createdAt: new Date().toISOString(),
              text: message.text,
              route: decision.route,
              routerTier: tier,
              decision: decision.action,
              status: decision.action === 'BLOCK' ? 'blocked' : 'routed',
            });
            reply = { type: 'routed', requestId: message.requestId, text: message.text, decision, tier, saved };
          } catch {
            reply = { type: 'routeError', requestId: message.requestId };
          }
          try {
            await view.webview.postMessage(reply);
          } catch {
            // A closed sidebar can no longer receive messages.
          }
        });
        view.onDidDispose(() => listener.dispose());

        try {
          const template = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(mediaRoot, 'panel.html'));
          const replacements: Record<string, string> = {
            nonce: randomBytes(16).toString('hex'),
            cspSource: view.webview.cspSource,
            scriptUri: view.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'panel.js')).toString(),
            historyUri: view.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'history.js')).toString(),
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
