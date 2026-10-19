import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { JsonStore } from './store';
import { isSessionViewMessage, SessionRecord } from './types';

export class SessionViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'baton.sessions';
  private view?: vscode.WebviewView;
  private activeSessionId?: string;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: JsonStore,
    private readonly onSelectSession: (sessionId: string) => Promise<void> | void,
    private readonly onNewSession: () => Promise<void> | void,
  ) {}

  public setActiveSessionId(id: string | undefined): void {
    this.activeSessionId = id;
    void this.postActiveSession();
  }

  public getActiveSessionId(): string | undefined {
    return this.activeSessionId;
  }

  public async refresh(): Promise<void> {
    if (!this.view) return;
    try {
      const workspace = this.currentWorkspace();
      const allSessions = (await this.store.loadSessions()) ?? [];
      const sessions = workspace
        ? allSessions.filter((s) => s.workspaceUri === workspace.uri)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        : [];
      await this.view.webview.postMessage({
        type: 'sessionsList',
        sessions,
        activeSessionId: this.activeSessionId,
        project: workspace ? { name: workspace.name, uri: workspace.uri } : undefined,
      });
    } catch {
      // Sidebar post failed, fall through safely
    }
  }

  private async postActiveSession(): Promise<void> {
    if (!this.view) return;
    try {
      await this.view.webview.postMessage({
        type: 'activeSessionChanged',
        activeSessionId: this.activeSessionId,
      });
    } catch {
      // closed
    }
  }

  public async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.view = webviewView;
    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, 'media');

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [mediaRoot],
    };

    webviewView.webview.onDidReceiveMessage(async (message: unknown) => {
      if (!isSessionViewMessage(message)) return;
      try {
        if (message.type === 'loadSessions') {
          await this.refresh();
        } else if (message.type === 'openProject') {
          await vscode.commands.executeCommand('vscode.openFolder');
        } else if (message.type === 'selectSession') {
          this.activeSessionId = message.sessionId;
          await this.onSelectSession(message.sessionId);
          await this.postActiveSession();
        } else if (message.type === 'newSession') {
          if (!this.currentWorkspace()) {
            void vscode.window.showWarningMessage('Please open or create a project first before creating tasks.');
            return;
          }
          await this.onNewSession();
        } else if (message.type === 'deleteSession') {
          await this.store.deleteSession(message.sessionId);
          if (this.activeSessionId === message.sessionId) {
            this.activeSessionId = undefined;
          }
          await this.refresh();
        }
      } catch {
        // Fall through safely
      }
    });

    webviewView.onDidDispose(() => {
      this.view = undefined;
    });

    try {
      const template = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(mediaRoot, 'session.html'));
      const replacements: Record<string, string> = {
        nonce: randomBytes(16).toString('hex'),
        cspSource: webviewView.webview.cspSource,
        scriptUri: webviewView.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'session.js')).toString(),
        styleUri: webviewView.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'session.css')).toString(),
      };
      webviewView.webview.html = Buffer.from(template).toString('utf8').replace(
        /\{\{(\w+)\}\}/g,
        (_, name: string) => replacements[name] ?? '',
      );
    } catch {
      webviewView.webview.html = '<!doctype html><html><body>Could not load session manager.</body></html>';
    }
  }

  private currentWorkspace(): { uri: string; name: string } | undefined {
    const editor = vscode.window.activeTextEditor;
    const folder = (editor && vscode.workspace.getWorkspaceFolder(editor.document.uri))
      ?? vscode.workspace.workspaceFolders?.find((entry) => entry.uri.scheme === 'file');
    return folder?.uri.scheme === 'file' ? { uri: folder.uri.toString(), name: folder.name } : undefined;
  }
}
