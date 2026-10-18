import type { SecretStorage } from 'vscode';
import { getKey } from '../secrets';
import { routeGemmaWithKey } from './gemma-client';

export async function routeGemma(secrets: SecretStorage, task: string, ctxSnippet: string): Promise<unknown> {
  const apiKey = await getKey(secrets, 'GEMINI_API_KEY');
  if (!apiKey) return undefined;
  return routeGemmaWithKey(apiKey, task, ctxSnippet);
}
