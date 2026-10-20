import { appendFile, lstat, open, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

const START = '<!-- Baton MCP instructions: start -->';
const END = '<!-- Baton MCP instructions: end -->';
const INSTRUCTIONS = `${START}
## Baton project knowledge

When Baton MCP is connected, call \`get_project_knowledge\` for the project overview, active plan, recent history, and shared agent/model index. Use \`search_combined_context\` to search saved project memory and shared knowledge together.

For a task, call \`get_task_context(task_id)\` to read its saved request, planning prompt, plan, handoffs, and summaries. Use \`get_task_prompt(task_id, kind, step_id)\` for one planning or step handoff prompt. Use \`baton_get_plan_summary\`, \`baton_list_summaries\`, and \`baton_get_step_summary\` when you only need summaries. Call \`get_agent_knowledge(agent_id)\` for source-backed agent and model details.

Baton MCP tools are read-only. If they are unavailable, connect the stdio server using **Baton: Copy MCP Config**. Keep this project's existing instructions in force.
${END}
`;

export type AgentInstructionsResult = 'created' | 'updated' | 'existing' | 'no-workspace' | 'failed';

/** Install only Baton's marked section and preserve all project-owned instructions. */
export async function ensureMcpAgentInstructions(projectRoot?: vscode.Uri): Promise<AgentInstructionsResult> {
  const editor = vscode.window.activeTextEditor;
  const active = editor && vscode.workspace.getWorkspaceFolder(editor.document.uri);
  const root = projectRoot ?? (active?.uri.scheme === 'file' ? active : undefined)?.uri
    ?? vscode.workspace.workspaceFolders?.find((folder) => folder.uri.scheme === 'file')?.uri;
  if (!root || root.scheme !== 'file') return 'no-workspace';

  try {
    const entries = await vscode.workspace.fs.readDirectory(root);
    const existing = entries.find(([name]) => name.toLowerCase() === 'agents.md')?.[0];
    const filename = path.join(root.fsPath, existing ?? 'AGENTS.md');
    if (!existing) {
      const handle = await open(filename, 'wx');
      try { await handle.writeFile(`# Project agent instructions\n\n${INSTRUCTIONS}`, 'utf8'); }
      finally { await handle.close(); }
      return 'created';
    }

    const info = await lstat(filename);
    if (!info.isFile() || info.size > 256 * 1024) return 'failed';
    const content = await readFile(filename, 'utf8');
    const start = content.indexOf(START);
    const end = content.indexOf(END);
    if (start >= 0 && end > start) {
      const next = `${content.slice(0, start)}${INSTRUCTIONS.trimEnd()}${content.slice(end + END.length)}`;
      if (next === content) return 'existing';
      await writeFile(filename, next, 'utf8');
      return 'updated';
    }
    if (start >= 0 || end >= 0) return 'failed';
    await appendFile(filename, `${content.endsWith('\n') ? '\n' : '\n\n'}${INSTRUCTIONS}`, 'utf8');
    return 'updated';
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') return 'existing';
    return 'failed';
  }
}
