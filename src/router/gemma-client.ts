import { parseJsonObject, parseRouteJson, ROUTE_INSTRUCTIONS, routePrompt } from './prompt';
import { RouterHttpError, withinDeadline } from './timeout';

const GEMMA_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:generateContent';

/** One Gemma request with the same 5xx retry the router has always used. */
async function requestGemma(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  const request = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { thinkingConfig: { thinkingLevel: 'minimal' } },
    }),
  };
  let response = await fetch(GEMMA_URL, request);
  if (response.status >= 500 && !signal.aborted) {
    try { await response.body?.cancel(); } catch { /* Retry is still safe. */ }
    response = await fetch(GEMMA_URL, request);
  }
  if (!response.ok) throw new RouterHttpError(response.status);
  const data: unknown = await response.json();
  if (typeof data !== 'object' || data === null || !('candidates' in data) || !Array.isArray(data.candidates)) {
    return undefined;
  }
  const first = data.candidates[0];
  const parts: unknown = first?.content?.parts;
  if (!Array.isArray(parts)) return undefined;
  const text = parts.filter((part) => part && part.thought !== true && typeof part.text === 'string')
    .map((part) => part.text).join('\n');
  return text || undefined;
}

export async function routeGemmaWithKey(apiKey: string, task: string, ctxSnippet: string): Promise<unknown> {
  return withinDeadline(async (signal) => {
    const text = await requestGemma(apiKey, ROUTE_INSTRUCTIONS, routePrompt(task, ctxSnippet), signal);
    return text ? parseRouteJson(text) : undefined;
  });
}

/** Generic JSON call for non-routing work; same model, timeout, and validation path. */
export async function callGemmaJsonWithKey(apiKey: string, systemPrompt: string, userPrompt: string): Promise<unknown> {
  return withinDeadline(async (signal) => {
    const text = await requestGemma(apiKey, systemPrompt, userPrompt, signal);
    return text ? parseJsonObject(text) : undefined;
  });
}
