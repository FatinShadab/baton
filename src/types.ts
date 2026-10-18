import type { ContextPart } from './context';

export type PanelMessage =
  | { type: 'previewContext'; text: string; requestId: number }
  | { type: 'routeTask'; text: string; requestId: number; sources: string[] };
export type PolicyDecision = {
  route: Route;
  action: 'RUN' | 'CONFIRM' | 'MANUAL_ONLY' | 'BLOCK';
  why: string;
};
export type RouterTier = 'gemma' | 'ollama' | 'rules';
export type RouterResult = { route: Route; tier: RouterTier };
export type ExtensionMessage =
  | { type: 'contextPreview'; requestId: number; parts: ContextPart[]; limit: number }
  | { type: 'routed'; requestId: number; text: string; decision: PolicyDecision; tier: RouterTier; saved: boolean }
  | { type: 'routeError'; requestId: number };

export function isPanelMessage(message: unknown): message is PanelMessage {
  if (typeof message !== 'object' || message === null
    || !('text' in message) || typeof message.text !== 'string'
    || !('requestId' in message) || !Number.isSafeInteger(message.requestId)
    || !('type' in message)) return false;
  return message.type === 'previewContext' || (message.type === 'routeTask'
    && 'sources' in message && Array.isArray(message.sources)
    && message.sources.every((source: unknown) => typeof source === 'string'));
}
import { z } from 'zod';

export const RouteSchema = z.object({
  task_type: z.enum(['research', 'planning', 'implementation', 'debugging', 'testing', 'review', 'docs']),
  risk_tier: z.enum(['low', 'moderate', 'high']),
  recommended_destination: z.enum(['codex', 'chatgpt_web', 'gemini_web']),
  research_needed: z.boolean(),
  reason: z.string().max(200),
});
export type Route = z.infer<typeof RouteSchema>;

export const TaskRecordSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  text: z.string(),
  route: RouteSchema,
  routerTier: z.enum(['gemma', 'ollama', 'rules']),
  decision: z.string(),
  plan: z.string().optional(),
  status: z.enum(['routed', 'planned', 'running', 'done', 'blocked']),
  outcome: z.string().optional(),
  changedFiles: z.array(z.string()).optional(),
});
export type TaskRecord = z.infer<typeof TaskRecordSchema>;

