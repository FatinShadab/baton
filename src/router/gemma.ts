import type { SecretStorage } from 'vscode';
import { preferredKey } from '../secrets';
import { routeGemmaWithKey } from './gemma-client';
import { RouterMissingKeyError } from './timeout';

export async function routeGemma(secrets: SecretStorage, task: string, ctxSnippet: string): Promise<unknown> {
  const apiKey = await preferredKey(secrets, 'gemma');
  if (!apiKey) throw new RouterMissingKeyError();
  return routeGemmaWithKey(apiKey, task, ctxSnippet);
}
