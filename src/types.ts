export type PanelMessage = { type: 'routeTask'; text: string };
export type PolicyDecision = {
  route: Route;
  action: 'RUN' | 'CONFIRM' | 'MANUAL_ONLY' | 'BLOCK';
  why: string;
};
export type ExtensionMessage = { type: 'routed'; decision: PolicyDecision };

export function isPanelMessage(message: unknown): message is PanelMessage {
  return typeof message === 'object' && message !== null
    && 'type' in message && message.type === 'routeTask'
    && 'text' in message && typeof message.text === 'string';
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

