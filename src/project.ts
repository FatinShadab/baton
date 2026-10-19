import * as vscode from 'vscode';

let lastProjectUri: string | undefined;

export function sameProject(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/** Keep the editor's project selected while the chat or sidebar has focus. */
export function currentProjectFolder(): vscode.WorkspaceFolder | undefined {
  const folders = vscode.workspace.workspaceFolders?.filter((folder) => folder.uri.scheme === 'file') ?? [];
  const editor = vscode.window.activeTextEditor;
  const editorFolder = editor && vscode.workspace.getWorkspaceFolder(editor.document.uri);
  const folder = editorFolder?.uri.scheme === 'file' ? editorFolder
    : folders.find((entry) => sameProject(entry.uri.toString(), lastProjectUri)) ?? folders[0];
  lastProjectUri = folder?.uri.toString();
  return folder;
}

export function currentProject(): { uri: string; name: string } | undefined {
  const folder = currentProjectFolder();
  return folder ? { uri: folder.uri.toString(), name: folder.name } : undefined;
}
