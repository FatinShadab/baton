import type { SecretStorage } from 'vscode';
import { getKey } from '../secrets';
import { parseRouteJson, ROUTE_INSTRUCTIONS, routePrompt } from './prompt';
import { RouterHttpError, RouterMissingKeyError, withinDeadline } from './timeout';

// Switch to 'gemma4:31b-cloud' if the cloud account requires that tag.
export const OLLAMA_MODEL = 'gemma4:31b';

export async function routeOllama(secrets: SecretStorage, task: string, ctxSnippet: string): Promise<unknown> {
  return withinDeadline(async (signal) => {
    const apiKey = await getKey(secrets, 'OLLAMA_API_KEY');
    if (!apiKey) throw new RouterMissingKeyError();
    if (signal.aborted) return undefined;
    const response = await fetch('https://ollama.com/api/chat', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          { role: 'system', content: ROUTE_INSTRUCTIONS },
          { role: 'user', content: routePrompt(task, ctxSnippet) },
        ],
        stream: false,
        format: 'json',
      }),
    });
    if (!response.ok) throw new RouterHttpError(response.status);
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null || !('message' in body)) return undefined;
    const message = body.message;
    if (typeof message !== 'object' || message === null || !('content' in message)
      || typeof message.content !== 'string') return undefined;
    return parseRouteJson(message.content);
  }, 12_000);
}
