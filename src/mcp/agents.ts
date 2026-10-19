import { open } from 'node:fs/promises';
import * as vscode from 'vscode';

const INSTRUCTIONS = `# Project agent instructions

Use the Baton MCP server for project context when it is available. Call \`get_project_overview\` to understand the project, \`get_project_history\` for recent tasks, \`search_project_context\` to find relevant local memory, and \`get_active_plan\` before continuing a planned task.

If Baton tools are not listed in your MCP client, use the Baton sidebar's connection hint and Copy config button to connect the server.
`;

export async function ensureMcpAgentInstructions(): Promise<'created' | 'existing' | 'no-workspace' | 'failed'> {
  const editor = vscode.window.activeTextEditor;
  const active = editor && vscode.workspace.getWorkspaceFolder(editor.document.uri);
  const root = (active?.uri.scheme === 'file' ? active : undefined)
    ?.uri ?? vscode.workspace.workspaceFolders?.find((folder) => folder.uri.scheme === 'file')?.uri;
  if (!root) return 'no-workspace';

  try {
    const entries = await vscode.workspace.fs.readDirectory(root);
    if (entries.some(([name]) => name.toLowerCase() === 'agents.md')) return 'existing';

    const handle = await open(vscode.Uri.joinPath(root, 'AGENTS.md').fsPath, 'wx');
    try {
      await handle.writeFile(INSTRUCTIONS, 'utf8');
    } finally {
      await handle.close();
    }
    return 'created';
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') return 'existing';
    return 'failed';
  }
}
