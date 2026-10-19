import type { SecretStorage } from 'vscode';
import { preferredKey } from '../secrets';
import { withinDeadline } from '../router/timeout';
import { GemmaResearchPlan, ResearchToolCall } from './types';

const GEMMA_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:generateContent';

const RESEARCH_AGENT_SYSTEM_INSTRUCTION = `You are Baton's research intelligence agent.
Given a developer's coding task and context, identify the core technical subjects and initiate 3 precise tool queries for Baton's research scrapers:
1. "search_youtube": Targeted keywords for video tutorials, implementation walkthroughs, and system overviews.
2. "search_blogs": Targeted keywords for engineering blogs (Dev.to / Hacker News) and developer documentation.
3. "search_arxiv": Concise academic, algorithmic, or model-architecture keywords for arXiv research preprints.

Respond with JSON ONLY in this exact structure:
{
  "tool_calls": [
    { "tool": "search_youtube", "query": "optimal youtube query" },
    { "tool": "search_blogs", "query": "optimal technical blog query" },
    { "tool": "search_arxiv", "query": "optimal academic keywords" }
  ]
}
Return JSON only. Do not wrap in markdown fences or add explanatory text.`;

/**
 * Uses Gemma 4 to analyze the task and formulate optimal search topics, initiating tool calls
 * for Baton's real scrapers (YouTube, Dev.to, arXiv).
 */
export async function planResearchWithGemma(
  secrets: SecretStorage,
  task: string,
  ctxSnippet = '',
): Promise<GemmaResearchPlan | undefined> {
  const apiKey = await preferredKey(secrets, 'gemma');
  if (!apiKey) return undefined;

  return withinDeadline(async (signal) => {
    const prompt = `Developer Task: "${task}"\nContext Excerpt: ${ctxSnippet.slice(0, 300)}`;
    const request = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: RESEARCH_AGENT_SYSTEM_INSTRUCTION }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 250,
          thinkingConfig: { thinkingLevel: 'minimal' },
        },
      }),
    };

    const response = await fetch(GEMMA_URL, request);
    if (!response.ok) return undefined;

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string; thought?: boolean }>;
        };
      }>;
    };

    const firstCandidate = data.candidates?.[0];
    const parts = firstCandidate?.content?.parts;
    if (!Array.isArray(parts)) return undefined;

    const rawText = parts
      .filter((p) => p && !p.thought && typeof p.text === 'string')
      .map((p) => p.text)
      .join('\n');

    if (!rawText) return undefined;

    const clean = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start < 0 || end < start) return undefined;

    const parsed = JSON.parse(clean.slice(start, end + 1)) as {
      tool_calls?: Array<{ tool?: string; query?: string }>;
    };

    if (!parsed || !Array.isArray(parsed.tool_calls) || parsed.tool_calls.length === 0) {
      return undefined;
    }

    const tool_calls: ResearchToolCall[] = [];
    for (const call of parsed.tool_calls) {
      if (
        call &&
        typeof call.query === 'string' &&
        call.query.trim() &&
        (call.tool === 'search_youtube' || call.tool === 'search_blogs' || call.tool === 'search_arxiv')
      ) {
        tool_calls.push({
          tool: call.tool,
          query: call.query.trim(),
        });
      }
    }

    return tool_calls.length > 0 ? { tool_calls } : undefined;
  }, 10_000).catch(() => undefined);
}
