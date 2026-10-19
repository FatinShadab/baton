import type { SecretStorage } from 'vscode';
import { createHash } from 'node:crypto';
import { TaskResourcesResult } from './types';
import { planResearchWithModel } from './gemma-search';
import { getRouterSettings } from '../router/settings';
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
 * 1. The selected model analyzes the task/context to formulate search topics.
 * 2. Baton's live search tools (YouTube, Dev.to/HN, arXiv) execute those queries in parallel.
 * 3. If both providers are unavailable, Baton falls back to direct keyword tools.
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

  const cacheKey = createHash('sha256').update(JSON.stringify([normalized.toLowerCase(), ctxSnippet, getRouterSettings()])).digest('hex');
  const cached = cache.get(cacheKey);
  if (cached) {
    return { ...cached, taskId };
  }

  // 1. The selected provider identifies topics and initiates tool calls
  let plan = await planResearchWithModel(secrets, normalized, ctxSnippet);
  const usedModel = Boolean(plan && plan.tool_calls && plan.tool_calls.length > 0);

  // If both providers are unavailable, fall back to keyword tools
  if (!plan) {
    const framework = /\b(?:from\s+flask\b|import\s+flask\b|Flask\s*\()/i.test(ctxSnippet) ? 'Flask Python'
      : /\b(?:from\s+fastapi\b|import\s+fastapi\b|FastAPI\s*\()/i.test(ctxSnippet) ? 'FastAPI Python'
      : /\b(?:from\s+django\b|import\s+django\b)/i.test(ctxSnippet) ? 'Django Python'
      : /\b[A-Za-z0-9_.-]+\.py\b/i.test(normalized) ? 'Python' : '';
    const subject = normalized.replace(/\b[A-Za-z0-9_.-]+\.(?:py|ts|tsx|js|jsx|go|rs|java|html|css)\b/gi, 'source file');
    plan = fallbackResearchPlan(`${framework} ${subject}`.trim());
  }

  // 2. Baton executes the live tools (YouTube, Dev.to, arXiv) in parallel
  try {
    const toolsResult = await executeResearchPlan(plan);

    const result: TaskResourcesResult = {
      taskId,
      query: normalized,
      tier: usedModel ? 'intelligent' : 'keyword',
      notice: usedModel
        ? 'Curated via your intelligent routing model · Live YouTube, Dev.to & arXiv tools.'
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
