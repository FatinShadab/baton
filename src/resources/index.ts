import type { SecretStorage } from 'vscode';
import { createHash } from 'node:crypto';
import { TaskResourcesResult } from './types';
import { planResearchWithGemma } from './gemma-search';
import {
  executeResearchPlan,
  fallbackResearchPlan,
  searchBlogsKeywords,
  searchKeywordPipeline,
  searchResearchKeywords,
  searchYouTubeKeywords,
} from './keyword-search';

export * from './types';
export {
  searchYouTubeKeywords,
  searchBlogsKeywords,
  searchResearchKeywords,
  executeResearchPlan,
  searchKeywordPipeline,
};

const cache = new Map<string, TaskResourcesResult>();
const CACHE_LIMIT = 50;

/**
 * Discovers technical tutorials, articles, and documentation resources for a coding task.
 * 
 * Flow:
 * 1. Gemma 4 analyzes the task/context to formulate optimal search topics and initiate tool calls.
 * 2. Baton's live search tools (YouTube, Dev.to/HN, arXiv) execute those queries in parallel.
 * 3. If Gemma is unconfigured or unavailable, Baton gracefully falls back to direct keyword tools.
 */
export async function discoverResources(
  secrets: SecretStorage,
  taskId: string,
  task: string,
  ctxSnippet = '',
): Promise<TaskResourcesResult> {
  const normalized = task.trim();
  if (!normalized) {
    return {
      taskId,
      query: '',
      tier: 'keyword',
      videos: [],
      blogs: [],
      artifacts: [],
    };
  }

  const cacheKey = createHash('sha256').update(normalized.toLowerCase()).digest('hex');
  const cached = cache.get(cacheKey);
  if (cached) {
    return { ...cached, taskId };
  }

  // 1. Gemma 4 identifies topics and initiates tool calls
  let plan = await planResearchWithGemma(secrets, normalized, ctxSnippet);
  const usedGemma = Boolean(plan && plan.tool_calls && plan.tool_calls.length > 0);

  // If Gemma is unavailable or timed out, fall back to keyword tool plan
  if (!plan) {
    plan = fallbackResearchPlan(normalized);
  }

  // 2. Baton executes the live tools (YouTube, Dev.to, arXiv) in parallel
  try {
    const toolsResult = await executeResearchPlan(plan);

    const result: TaskResourcesResult = {
      taskId,
      query: normalized,
      tier: usedGemma ? 'intelligent' : 'keyword',
      notice: usedGemma
        ? 'Curated via Gemma 4 topics · Live YouTube, Dev.to & arXiv tools.'
        : 'Discovered via keyword & syntax search (YouTube, Dev.to, arXiv).',
      videos: toolsResult.videos,
      blogs: toolsResult.blogs,
      artifacts: toolsResult.artifacts,
    };

    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    cache.set(cacheKey, result);
    return result;
  } catch {
    return {
      taskId,
      query: normalized,
      tier: 'keyword',
      notice: 'Could not load external resources.',
      videos: [],
      blogs: [],
      artifacts: [],
    };
  }
}
