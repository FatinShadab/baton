import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { serverOptions } from './config';

export class McpSession implements vscode.Disposable {
  private client?: Client;
  private transport?: StdioClientTransport;

  constructor(private readonly context: vscode.ExtensionContext) {}

  get running(): boolean { return Boolean(this.client); }

  async start(): Promise<string> {
    if (this.client) return 'MCP server is already running.';
    let options;
    try { options = serverOptions(this.context); }
    catch { return 'Open a local project folder before starting MCP.'; }
    const { command, args, env, cwd } = options;
    const transport = new StdioClientTransport({ command, args, env: { ...getDefaultEnvironment(), ...env }, cwd: cwd.fsPath });
    const client = new Client({ name: 'baton-sidebar', version: '0.0.1' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('MCP startup timed out.')), 8_000); });
      await Promise.race([client.connect(transport), timeout]);
      const tools = await Promise.race([client.listTools(), timeout]);
      this.client = client;
      this.transport = transport;
      return `MCP server running (${tools.tools.length} tools).`;
    } catch {
      try { await client.close(); } catch { /* server did not connect */ }
      try { await transport.close(); } catch { /* server did not start */ }
      return 'Could not start MCP server. Run Baton: build and try again.';
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async stop(): Promise<string> {
    const client = this.client;
    const transport = this.transport;
    this.client = undefined;
    this.transport = undefined;
    try { await client?.close(); } catch { /* already closed */ }
    try { await transport?.close(); } catch { /* already closed */ }
    return 'MCP server stopped.';
  }

  dispose(): void { void this.stop(); }
}
