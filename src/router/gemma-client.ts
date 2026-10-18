import { GoogleGenAI } from '@google/genai';
import { parseRouteJson, ROUTE_INSTRUCTIONS, routePrompt } from './prompt';
import { ROUTER_TIMEOUT_MS, withinDeadline } from './timeout';

const GEMMA_MODEL = 'gemma-4-26b-a4b-it';

function rejectsFormat(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { status, message } = error as { status?: number; message?: unknown };
  if (typeof message !== 'string') return false;
  const code = status ?? Number(message.match(/got status:\s*(\d{3})/i)?.[1]);
  return (code === 400 || code === 422)
    && /system[\s_]?instruction|system[\s_-]?(?:role|message)|response[\s_]?mime[\s_]?type|json[\s_-]?(?:mode|format)|application\/json/i.test(message);
}

export async function routeGemmaWithKey(apiKey: string, task: string, ctxSnippet: string): Promise<unknown> {
  return withinDeadline(async (signal) => {
    const ai = new GoogleGenAI({ apiKey, vertexai: false });
    const contents = routePrompt(task, ctxSnippet);
    const config = { abortSignal: signal, httpOptions: { timeout: ROUTER_TIMEOUT_MS } };
    let response;
    try {
      response = await ai.models.generateContent({
        model: GEMMA_MODEL,
        contents,
        config: { ...config, systemInstruction: ROUTE_INSTRUCTIONS, responseMimeType: 'application/json' },
      });
    } catch (error) {
      if (signal.aborted || !rejectsFormat(error)) throw error;
      response = await ai.models.generateContent({
        model: GEMMA_MODEL,
        contents: `${ROUTE_INSTRUCTIONS}\n\nTask and context:\n${contents}`,
        config,
      });
    }
    return parseRouteJson(response.text ?? '');
  });
}
