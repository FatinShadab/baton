import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getActivePlan, getPlanSummary, getProjectHistory, getProjectOverview, getStepSummary, getTaskContext, getTaskPrompt, getTaskSummary, listSummaries, searchProjectContext } from './data';
import { getAgentKnowledge, getKnowledgeBaseOverview, searchKnowledgeBase } from './knowledge';

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
  handler: (args: Record<string, any>) => Promise<ToolReply>,
) => void;

registerTool('get_project_overview', {
  description: 'Read the project README summary, saved constraints and preferences, and a file tree no deeper than two levels.',
  inputSchema: {},
}, async () => {
  try { return result(await getProjectOverview()); } catch (error) { return failure(error); }
});

registerTool('get_project_knowledge', {
  description: 'One-call entry point for project overview, active plan, recent Baton history, and the shared agent/model knowledge index.',
  inputSchema: {},
}, async () => {
  try {
    const [project, activePlan, history, knowledgeBase] = await Promise.all([
      getProjectOverview(), getActivePlan(), getProjectHistory(), getKnowledgeBaseOverview(),
    ]);
    return result({ project, activePlan, history, knowledgeBase });
  } catch (error) { return failure(error); }
});

registerTool('search_project_context', {
  description: 'Search Baton local memory for relevant plans, decisions, and completed tasks.',
  inputSchema: { query: z.string().trim().min(1).max(200) },
}, async ({ query }) => {
  try { return result(await searchProjectContext(query)); } catch (error) { return failure(error); }
});

registerTool('get_knowledge_base_overview', {
  description: 'List the shared Baton agent/model knowledge base, including IDs, availability metadata, and last verification dates. Start here to discover agent IDs.',
  inputSchema: {},
}, async () => {
  try { return result(await getKnowledgeBaseOverview()); } catch (error) { return failure(error); }
});

registerTool('get_agent_knowledge', {
  description: 'Read all saved knowledge and source-backed claims for one agent and its models. Use an agent ID from get_knowledge_base_overview.',
  inputSchema: { agent_id: z.string().trim().min(1).max(100) },
}, async ({ agent_id }) => {
  try { return result(await getAgentKnowledge(agent_id)); } catch (error) { return failure(error); }
});

registerTool('search_knowledge_base', {
  description: 'Search shared Baton agent/model knowledge, including evidence-backed claims and source URLs. Returns up to 20 ranked hits.',
  inputSchema: { query: z.string().trim().min(1).max(200) },
}, async ({ query }) => {
  try { return result(await searchKnowledgeBase(query)); } catch (error) { return failure(error); }
});

registerTool('search_combined_context', {
  description: 'Search both this project’s private task memory and the shared Baton agent/model knowledge base in one call.',
  inputSchema: { query: z.string().trim().min(1).max(200) },
}, async ({ query }) => {
  try {
    const [projectMemory, knowledgeBase] = await Promise.all([searchProjectContext(query), searchKnowledgeBase(query)]);
    return result({ projectMemory, knowledgeBase });
  } catch (error) { return failure(error); }
});

registerTool('get_active_plan', {
  description: 'Read the latest planned task and saved plan for this project.',
  inputSchema: {},
}, async () => {
  try { return result(await getActivePlan()); } catch (error) { return failure(error); }
});

registerTool('get_project_history', {
  description: 'Read the 20 most recent Baton tasks for this project, including status, outcome, and plan summaries.',
  inputSchema: {},
}, async () => {
  try { return result(await getProjectHistory()); } catch (error) { return failure(error); }
});

registerTool('get_task_summary', {
  description: 'Read the saved finish summary for one task in this project.',
  inputSchema: { taskId: z.string().regex(/^[a-f0-9]{12}$/) },
}, async ({ taskId }) => {
  try { return result(await getTaskSummary(taskId)); } catch (error) { return failure(error); }
});

registerTool('get_task_context', {
  description: 'Read one project task’s saved request, planning prompt, context excerpt, full plan, plan summary, step handoff prompts, step summaries, triage, and finish summary. Returns null when absent.',
  inputSchema: { task_id: z.string().regex(/^[a-f0-9]{12}$/) },
}, async ({ task_id }) => {
  try { return result(await getTaskContext(task_id)); } catch (error) { return failure(error); }
});

registerTool('get_task_prompt', {
  description: 'Read the saved planning prompt or one step handoff prompt for a project task. Provide step_id for kind=handoff.',
  inputSchema: {
    task_id: z.string().regex(/^[a-f0-9]{12}$/),
    kind: z.enum(['planning', 'handoff']),
    step_id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/).optional(),
  },
}, async ({ task_id, kind, step_id }) => {
  try { return result(await getTaskPrompt(task_id, kind, step_id)); } catch (error) { return failure(error); }
});

registerTool('baton_get_step_summary', {
  description: 'Read the saved finish summary for a specific step of a Baton task.',
  inputSchema: { task_id: z.string().regex(/^[a-f0-9]{12}$/), step_id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/) },
}, async ({ task_id, step_id }) => {
  try { return result(await getStepSummary(task_id, step_id)); } catch (error) { return failure(error); }
});

registerTool('baton_list_summaries', {
  description: 'List all saved step summaries for a Baton task.',
  inputSchema: { task_id: z.string().regex(/^[a-f0-9]{12}$/) },
}, async ({ task_id }) => {
  try { return result(await listSummaries(task_id)); } catch (error) { return failure(error); }
});

registerTool('baton_get_plan_summary', {
  description: 'Read the structured plan summary (steps, dependencies, files) for a Baton task.',
  inputSchema: { task_id: z.string().regex(/^[a-f0-9]{12}$/) },
}, async ({ task_id }) => {
  try { return result(await getPlanSummary(task_id)); } catch (error) { return failure(error); }
});

void server.connect(new StdioServerTransport()).catch((error: unknown) => {
  console.error('Baton MCP server failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
