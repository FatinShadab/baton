import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { serverOptions } from './config';
import { ensureMcpAgentInstructions } from './agents';

export class McpSession implements vscode.Disposable {
  private client?: Client;
  private transport?: StdioClientTransport;
  private activeOptions?: ReturnType<typeof serverOptions>;

  constructor(private readonly context: vscode.ExtensionContext) {}

  get running(): boolean { return Boolean(this.client); }

  options(): ReturnType<typeof serverOptions> { return this.activeOptions ?? serverOptions(this.context); }

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
      const required = ['get_project_knowledge', 'search_combined_context', 'get_task_context',
        'get_task_prompt', 'baton_get_plan_summary', 'baton_list_summaries'];
      if (required.some((name) => !tools.tools.some((tool) => tool.name === name))) {
        throw new Error('Baton MCP tools are missing.');
      }
      const probe = await Promise.race([client.callTool({ name: 'get_project_knowledge', arguments: {} }), timeout]);
      if (probe.isError) throw new Error('Baton knowledge base is unavailable.');
      this.client = client;
      this.transport = transport;
      this.activeOptions = options;
      const instructions = await ensureMcpAgentInstructions(cwd);
      const note = instructions === 'created' ? ' Created AGENTS.md.'
        : instructions === 'updated' ? ' Updated the Baton section in AGENTS.md.'
          : instructions === 'failed' ? ' Could not update AGENTS.md.' : '';
      return `MCP server running (${tools.tools.length} tools).${note}`;
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
    this.activeOptions = undefined;
    try { await client?.close(); } catch { /* already closed */ }
    try { await transport?.close(); } catch { /* already closed */ }
    return 'MCP server stopped.';
  }

  dispose(): void { void this.stop(); }
}
