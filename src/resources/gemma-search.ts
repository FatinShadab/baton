import type { SecretStorage } from 'vscode';
import { z } from 'zod';
import { callJson } from '../router';
import { GemmaResearchPlan } from './types';

const RESEARCH_AGENT_SYSTEM_INSTRUCTION = `You are Baton's research intelligence agent.
Given a developer's coding task and context, identify the core technical subjects and initiate 3 concise tool queries for Baton's live search tools:
1. "search_youtube": Keywords for video tutorials and walkthroughs (e.g. "genetic algorithm python tutorial", "react server actions demo").
2. "search_blogs": Keywords for developer articles on Dev.to and Hacker News (e.g. "genetic algorithm python implementation", "nextjs server actions guide").
3. "search_arxiv": Academic, algorithmic, or theoretical keywords for arXiv preprints (e.g. "genetic algorithm optimization", "transformer attention").

Rules:
- Keep each query focused and concise (3-6 technical words).
- Avoid generic filler words or conversational phrases.
- Use the language and framework shown in project context; treat local filenames as code files, not product names.
- Respond with JSON ONLY in this exact structure:
{
  "tool_calls": [
    { "tool": "search_youtube", "query": "..." },
    { "tool": "search_blogs", "query": "..." },
    { "tool": "search_arxiv", "query": "..." }
  ]
}
Return JSON only. Do not wrap in markdown fences or add explanatory text.`;

/**
 * Uses the configured model to plan searches for Baton's resource tools.
 */
export async function planResearchWithModel(
  _secrets: SecretStorage,
  task: string,
  ctxSnippet = '',
): Promise<GemmaResearchPlan | undefined> {
  const fileHint = /\b[A-Za-z0-9_.-]+\.py\b/i.test(task) ? 'Python source file' : '';
  const prompt = `Developer Task: "${task}"\nFile Hint: ${fileHint}\nContext Excerpt: ${ctxSnippet.slice(0, 300)}`;
  const schema = z.object({
    tool_calls: z.array(z.object({
      tool: z.enum(['search_youtube', 'search_blogs', 'search_arxiv']),
      query: z.string().trim().min(1),
    })).min(1),
  });
  return callJson(RESEARCH_AGENT_SYSTEM_INSTRUCTION, prompt, schema).catch(() => undefined);
}
