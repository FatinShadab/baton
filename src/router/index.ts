import type { Disposable, SecretStorage } from 'vscode';
import { createHash } from 'node:crypto';
import { RouteSchema, RouterResult } from '../types';
import { routeGemma } from './gemma';
import { routeOllama } from './ollama';
import { classify } from './rules';
import { RouterHttpError, RouterMissingKeyError, RouterTimeoutError } from './timeout';

const cache = new Map<string, RouterResult>();
const CACHE_LIMIT = 100;
let keyStore: SecretStorage | undefined;
let generation = 0;

export function initializeRouter(secrets: SecretStorage): Disposable {
  keyStore = secrets;
  cache.clear();
  generation++;
  return secrets.onDidChange(({ key }) => {
    if (key === 'GEMINI_API_KEY' || key === 'BATON_PERSONAL_GEMINI_API_KEY' || key === 'OLLAMA_API_KEY') {
      cache.clear();
      generation++;
    }
  });
}

export async function routeTask(task: string, ctxSnippet: string, workspaceUri = ''): Promise<RouterResult> {
  // A changed sharing selection must not reuse a route based on excluded context.
  const cacheKey = createHash('sha256').update(JSON.stringify([task, ctxSnippet, workspaceUri])).digest('hex');
  const cached = cache.get(cacheKey);
  if (cached) return { ...cached, route: { ...cached.route } };
  const startedGeneration = generation;
  let result: RouterResult | undefined;
  const failures: string[] = [];
  if (keyStore && task.trim()) {
    for (const [tier, provider] of [['gemma', routeGemma], ['ollama', routeOllama]] as const) {
      try {
        const value = await provider(keyStore, task, ctxSnippet);
        const parsed = RouteSchema.safeParse(value);
        if (parsed.success) {
          result = { route: parsed.data, tier };
          break;
        }
        failures.push(`${tier}: ${value === undefined ? 'empty response' : 'invalid route response'}`);
      } catch (error) {
        const reason = error instanceof RouterTimeoutError ? 'timed out'
          : error instanceof RouterHttpError ? `HTTP ${error.status}`
          : error instanceof RouterMissingKeyError ? 'API key missing'
          : error instanceof SyntaxError ? 'invalid JSON'
          : 'connection failed';
        failures.push(`${tier}: ${reason}`);
      }
    }
  }
  if (result?.tier === 'ollama' && failures.length) {
    result.notice = `Gemma unavailable (${failures[0]}). Routed via Ollama.`;
  }
  result ??= { route: RouteSchema.parse(classify(task)), tier: 'rules',
    notice: `Using local rules (${failures.join('; ') || 'router unavailable'}).` };
  // A temporary provider failure must not pin this task to the rules tier.
  if (result.tier !== 'rules' && startedGeneration === generation) {
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    cache.set(cacheKey, { ...result, route: { ...result.route } });
  }
  return result;
}
