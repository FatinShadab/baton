import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { setKeys } from './secrets';
import { JsonStore } from './store';
import { classify } from './router/rules';
import { decide } from './policy';
import { ExtensionMessage, isPanelMessage } from './types';

export function activate(context: vscode.ExtensionContext): { store: JsonStore } {
  const mediaRoot = vscode.Uri.joinPath(context.extensionUri, 'media');
  const store = new JsonStore(context.globalStorageUri);
  void store.loadTasks();

  context.subscriptions.push(
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
          const reply: ExtensionMessage = { type: 'routed', decision: decide(classify(message.text), message.text) };
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
