import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getActivePlan, getProjectOverview, searchProjectContext } from './data';

const server = new McpServer({ name: 'baton', version: '0.0.1' });

function result(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

function failure(error: unknown) {
  return { content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Unable to read Baton data.' }], isError: true };
}

type ToolReply = ReturnType<typeof result> | ReturnType<typeof failure>;
// The SDK's generic registerTool signature exceeds TypeScript 5.7's inference depth here.
const registerTool = server.registerTool.bind(server) as unknown as (
  name: string,
  config: { description: string; inputSchema: Record<string, z.ZodTypeAny> },
  handler: (args: { query: string }) => Promise<ToolReply>,
) => void;

registerTool('get_project_overview', {
  description: 'Read the project README summary and a file tree no deeper than two levels.',
  inputSchema: {},
}, async () => {
  try { return result(await getProjectOverview()); } catch (error) { return failure(error); }
});

registerTool('search_project_context', {
  description: 'Search Baton local memory for relevant plans, decisions, and completed tasks.',
  inputSchema: { query: z.string().trim().min(1).max(200) },
}, async ({ query }) => {
  try { return result(await searchProjectContext(query)); } catch (error) { return failure(error); }
});

registerTool('get_active_plan', {
  description: 'Read the latest task with planned status and return its saved plan.',
  inputSchema: {},
}, async () => {
  try { return result(await getActivePlan()); } catch (error) { return failure(error); }
});

void server.connect(new StdioServerTransport()).catch((error: unknown) => {
  console.error('Baton MCP server failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
