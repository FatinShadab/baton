import * as vscode from 'vscode';

const PROVIDER_ID = 'baton.local-context';

type McpDefinition = { cwd?: vscode.Uri };
type McpApi = {
  lm?: { registerMcpServerDefinitionProvider?: (
    id: string, provider: { provideMcpServerDefinitions: () => McpDefinition[] },
  ) => vscode.Disposable };
  McpStdioServerDefinition?: new (
    options: { label: string; command: string; args: string[]; env: Record<string, string>; cwd: vscode.Uri },
  ) => McpDefinition;
};

export function serverOptions(context: vscode.ExtensionContext) {
  const root = vscode.workspace.workspaceFolders?.find((folder) => folder.uri.scheme === 'file')?.uri
    ?? context.extensionUri;
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
    context.subscriptions.push(api.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, {
      provideMcpServerDefinitions: () => {
        const { command, args, env, cwd } = serverOptions(context);
        const definition = new api.McpStdioServerDefinition!({ label: 'Baton project context', command, args, env, cwd });
        return [definition];
      },
    }));
  } catch {
    // Older VS Code versions do not expose the MCP provider API.
  }
}
