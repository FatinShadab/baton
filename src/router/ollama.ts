import type { SecretStorage } from 'vscode';
import { preferredKey } from '../secrets';
import { parseJsonObject, parseRouteJson, ROUTE_INSTRUCTIONS, routePrompt } from './prompt';
import { RouterHttpError, RouterMissingKeyError, withinDeadline } from './timeout';
import { getRouterSettings } from './settings';

const OLLAMA_TIMEOUT_MS = 12_000;

async function requestOllama(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  const response = await fetch('https://ollama.com/api/chat', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model: getRouterSettings().ollamaModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
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
  return message.content;
}

export async function routeOllama(secrets: SecretStorage, task: string, ctxSnippet: string): Promise<unknown> {
  return withinDeadline(async (signal) => {
    const apiKey = await preferredKey(secrets, 'ollama');
    if (!apiKey) throw new RouterMissingKeyError();
    if (signal.aborted) return undefined;
    const content = await requestOllama(apiKey, ROUTE_INSTRUCTIONS, routePrompt(task, ctxSnippet), signal);
    return content ? parseRouteJson(content) : undefined;
  }, OLLAMA_TIMEOUT_MS);
}

/** Generic JSON call for non-routing work; same model, timeout, and validation path. */
export async function callOllamaJsonWithKey(apiKey: string, systemPrompt: string, userPrompt: string): Promise<unknown> {
  return withinDeadline(async (signal) => {
    const content = await requestOllama(apiKey, systemPrompt, userPrompt, signal);
    return content ? parseJsonObject(content) : undefined;
  }, OLLAMA_TIMEOUT_MS);
}
