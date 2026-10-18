import type { Disposable, SecretStorage } from 'vscode';
import { RouteSchema, RouterResult } from '../types';
import { routeGemma } from './gemma';
import { routeOllama } from './ollama';
import { classify } from './rules';

const cache = new Map<string, RouterResult>();
const CACHE_LIMIT = 100;
let keyStore: SecretStorage | undefined;
let generation = 0;

export function initializeRouter(secrets: SecretStorage): Disposable {
  keyStore = secrets;
  cache.clear();
  generation++;
  return secrets.onDidChange(({ key }) => {
    if (key === 'GEMINI_API_KEY' || key === 'OLLAMA_API_KEY') {
      cache.clear();
      generation++;
    }
  });
}

export async function routeTask(task: string, ctxSnippet: string): Promise<RouterResult> {
  const cached = cache.get(task);
  if (cached) return { route: { ...cached.route }, tier: cached.tier };
  const startedGeneration = generation;
  let result: RouterResult | undefined;
  if (keyStore && task.trim()) {
    for (const [tier, provider] of [['gemma', routeGemma], ['ollama', routeOllama]] as const) {
      try {
        const parsed = RouteSchema.safeParse(await provider(keyStore, task, ctxSnippet));
        if (parsed.success) {
          result = { route: parsed.data, tier };
          break;
        }
      } catch {
        // Keep routing even if a provider fails before returning its response.
      }
    }
  }
  result ??= { route: RouteSchema.parse(classify(task)), tier: 'rules' };
  if (startedGeneration === generation) {
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    cache.set(task, { route: { ...result.route }, tier: result.tier });
  }
  return result;
}
