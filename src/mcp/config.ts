import * as vscode from 'vscode';

const PROVIDER_ID = 'baton.local-context';

type McpDefinition = { cwd?: vscode.Uri };
type McpApi = {
  lm?: { registerMcpServerDefinitionProvider?: (
    id: string, provider: { provideMcpServerDefinitions: () => McpDefinition[];
      onDidChangeMcpServerDefinitions?: vscode.Event<void> },
  ) => vscode.Disposable };
  McpStdioServerDefinition?: new (
    label: string, command: string, args?: string[], env?: Record<string, string>,
  ) => McpDefinition;
};

function localFolders(): readonly vscode.WorkspaceFolder[] {
  return vscode.workspace.workspaceFolders?.filter((folder) => folder.uri.scheme === 'file') ?? [];
}

export function serverOptions(context: vscode.ExtensionContext, folder?: vscode.WorkspaceFolder) {
  const editor = vscode.window.activeTextEditor;
  const active = editor && vscode.workspace.getWorkspaceFolder(editor.document.uri);
  const root = (folder ?? (active?.uri.scheme === 'file' ? active : undefined) ?? localFolders()[0])?.uri;
  if (!root) throw new Error('Open a local project folder before starting Baton MCP.');
  return {
    command: 'node',
    args: [vscode.Uri.joinPath(context.extensionUri, 'out', 'mcp.js').fsPath],
    env: {
      BATON_MEMORY_PATH: vscode.Uri.joinPath(context.globalStorageUri, 'memory.json').fsPath,
      BATON_PROJECT_ROOT: root.fsPath,
    },
    cwd: root,
  };
}

export async function copyMcpConfig(context: vscode.ExtensionContext): Promise<void> {
  try {
    const { command, args, env } = serverOptions(context);
    const snippet = JSON.stringify({ mcpServers: { baton: { command, args, env } } }, null, 2);
    await vscode.env.clipboard.writeText(snippet);
    void vscode.window.showInformationMessage('Baton MCP configuration copied to the clipboard.');
  } catch {
    void vscode.window.showErrorMessage('Baton could not copy the MCP configuration.');
  }
}

export function registerMcpProvider(context: vscode.ExtensionContext): void {
  const api = vscode as unknown as McpApi;
  if (!api.lm?.registerMcpServerDefinitionProvider || !api.McpStdioServerDefinition) return;
  try {
    const changed = new vscode.EventEmitter<void>();
    context.subscriptions.push(changed, vscode.workspace.onDidChangeWorkspaceFolders(() => changed.fire()));
    context.subscriptions.push(api.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, {
      onDidChangeMcpServerDefinitions: changed.event,
      provideMcpServerDefinitions: () => localFolders().map((folder) => {
        const { command, args, env, cwd } = serverOptions(context, folder);
        const definition = new api.McpStdioServerDefinition!(`Baton: ${folder.name}`, command, args, env);
        definition.cwd = cwd;
        return definition;
      }),
    }));
  } catch {
    // Older VS Code versions do not expose the MCP provider API.
  }
}
