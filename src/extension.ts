import * as vscode from 'vscode';
import { randomBytes, randomUUID } from 'node:crypto';
import { setKeys } from './secrets';
import { JsonStore } from './store';
import { initializeRouter, routeTask } from './router';
import { decide } from './policy';
import { ExtensionMessage, isPanelMessage } from './types';

export function activate(context: vscode.ExtensionContext): { store: JsonStore } {
  const mediaRoot = vscode.Uri.joinPath(context.extensionUri, 'media');
  const store = new JsonStore(context.globalStorageUri);
  void store.loadTasks();

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
        const listener = view.webview.onDidReceiveMessage(async (message: unknown) => {
          if (!isPanelMessage(message)) return;
          let reply: ExtensionMessage;
          try {
            // Context collection is separate; routing does not read workspace files.
            const { route, tier } = await routeTask(message.text, '');
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
            reply = { type: 'routed', text: message.text, decision, tier, saved };
          } catch {
            reply = { type: 'routeError' };
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
  return { store };
}
