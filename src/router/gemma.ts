import type { SecretStorage } from 'vscode';
import { getKey } from '../secrets';
import { routeGemmaWithKey } from './gemma-client';
import { RouterMissingKeyError } from './timeout';

export async function routeGemma(secrets: SecretStorage, task: string, ctxSnippet: string): Promise<unknown> {
  const apiKey = await getKey(secrets, 'GEMINI_API_KEY');
  if (!apiKey) throw new RouterMissingKeyError();
  return routeGemmaWithKey(apiKey, task, ctxSnippet);
}
