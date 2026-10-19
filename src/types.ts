import type { ContextPart } from './context';

export type PanelMessage =
  | { type: 'previewContext'; text: string; requestId: number }
  | { type: 'routeTask'; text: string; requestId: number; sources: string[] };
export type HistoryMessage =
  | { type: 'loadHistory' }
  | { type: 'importPlan'; taskId: string; plan: string };
export type TaskAction = 'runCodex' | 'markDone' | 'showDiff' | 'runTests';
export type TaskActionMessage = { type: TaskAction; taskId: string };
export type TaskActionReply = { type: 'taskActionResult'; taskId: string; notice: string };

export function isTaskActionMessage(message: unknown): message is TaskActionMessage {
  if (typeof message !== 'object' || message === null) return false;
  return 'type' in message && typeof message.type === 'string'
    && ['runCodex', 'markDone', 'showDiff', 'runTests'].includes(message.type)
    && 'taskId' in message && typeof message.taskId === 'string' && message.taskId.length > 0;
}
export type HistoryReply =
  | { type: 'history'; tasks: TaskRecord[]; notice?: string; changed: boolean; projectName?: string }
  | { type: 'historyError'; message: string };

export type HandoffMessage =
  | { type: 'planExternal'; target: 'chatgpt' | 'gemini' | 'antigravity'; taskId: string }
  | { type: 'openExternalHandoff'; target: 'chatgpt' | 'gemini' }
  | { type: 'handoffAvailabilityRequest' }
  | { type: 'savePlan'; taskId: string; plan: string }
  | { type: 'readClipboard' };
export type HandoffReply =
  | { type: 'clipboardContent'; text: string }
  | { type: 'planSaved'; taskId: string; notice: string }
  | { type: 'planSaveError'; message: string };

export type VoiceMessage =
  | { type: 'startVoiceRecorder' };
export type VoiceReply =
  | { type: 'voiceRecorderReady' }
  | { type: 'voiceTranscribing' }
  | { type: 'voiceText'; text: string; autoRoute: boolean }
  | { type: 'voiceError'; message: string };

export function isVoiceMessage(message: unknown): message is VoiceMessage {
  if (typeof message !== 'object' || message === null || !('type' in message)) return false;
  return message.type === 'startVoiceRecorder';
}

export function isHandoffMessage(message: unknown): message is HandoffMessage {
  if (typeof message !== 'object' || message === null || !('type' in message)) return false;
  if (message.type === 'handoffAvailabilityRequest') return true;
  if (message.type === 'readClipboard') return true;
  if (message.type === 'openExternalHandoff') return 'target' in message
    && (message.target === 'chatgpt' || message.target === 'gemini');
  if (message.type === 'planExternal' && 'target' in message && 'taskId' in message
    && typeof message.taskId === 'string' && message.taskId.length > 0
    && (message.target === 'chatgpt' || message.target === 'gemini'
      || message.target === 'antigravity')) return true;
  if (message.type === 'savePlan' && 'taskId' in message && 'plan' in message
    && typeof message.taskId === 'string' && message.taskId.length > 0
    && typeof message.plan === 'string' && message.plan.trim().length > 0
    && Buffer.byteLength(message.plan, 'utf8') <= 100 * 1024) return true;
  return false;
}

export function isHistoryMessage(message: unknown): message is HistoryMessage {
  if (typeof message !== 'object' || message === null || !('type' in message)) return false;
  if (message.type === 'loadHistory') return true;
  if (!('taskId' in message) || typeof message.taskId !== 'string' || !message.taskId) return false;
  return message.type === 'importPlan' && 'plan' in message && typeof message.plan === 'string'
    && message.plan.trim().length > 0 && Buffer.byteLength(message.plan, 'utf8') <= 100 * 1024;
}
import type { TaskResourcesResult } from './resources/types';
export type { TaskResourcesResult } from './resources/types';

export type PolicyDecision = {
  route: Route;
  action: 'RUN' | 'CONFIRM' | 'MANUAL_ONLY' | 'BLOCK';
  why: string;
  overrode?: boolean;
};
export type RouterTier = 'gemma' | 'ollama' | 'rules';
export type RouterResult = { route: Route; tier: RouterTier; notice?: string };
export type ExtensionMessage =
  | { type: 'contextPreview'; requestId: number; parts: ContextPart[]; limit: number }
  | { type: 'routed'; requestId: number; taskId: string; text: string; decision: PolicyDecision; tier: RouterTier; saved: boolean; notice?: string; contextSnippet?: string; contextParts?: ContextPart[] }
  | { type: 'routeError'; requestId: number }
  | { type: 'resourcesSearching'; taskId: string; query: string }
  | { type: 'resourcesReady'; resources: TaskResourcesResult };

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
  recommended_destination: z.enum(['codex', 'antigravity', 'copilot', 'chatgpt_web', 'gemini_web']),
  research_needed: z.boolean(),
  reason: z.string().max(200),
  recommended_model: z.string().nullable().optional(),
  model_reasoning: z.enum(['low', 'medium', 'high', 'default']).nullable().optional(),
  kb_refs: z.array(z.string()).optional(),
  kb_stale: z.boolean().optional(),
  kb_unverified: z.boolean().optional(),
  kb_docs_verified: z.boolean().optional(),
  kb_note: z.string().nullable().optional(),
  kb_claims: z.array(z.object({ text: z.string(), source_url: z.string().url(), origin: z.enum(['docs', 'manual', 'seed']) })).optional(),
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
  workspaceUri: z.string().optional(),
  contextSnippet: z.string().max(6000).optional(),
  recommended_model: z.string().nullable().optional(),
  model_reasoning: z.enum(['low', 'medium', 'high', 'default']).nullable().optional(),
  kb_refs: z.array(z.string()).optional(),
  kb_stale: z.boolean().optional(),
  kb_note: z.string().nullable().optional(),
  approvals: z.array(z.object({ approvedAt: z.string().datetime(), workspaceUri: z.string() })).optional(),
});
export type TaskRecord = z.infer<typeof TaskRecordSchema>;

export const SessionTurnSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  createdAt: z.string(),
  taskId: z.string().optional(),
  route: RouteSchema.optional(),
  decision: z.string().optional(),
  routerTier: z.enum(['gemma', 'ollama', 'rules']).optional(),
  plan: z.string().optional(),
  status: z.enum(['routed', 'planned', 'running', 'done', 'blocked']).optional(),
  outcome: z.string().optional(),
  contextSnippet: z.string().max(6000).optional(),
  why: z.string().optional(),
  overrode: z.boolean().optional(),
  recommended_model: z.string().nullable().optional(),
  model_reasoning: z.enum(['low', 'medium', 'high', 'default']).nullable().optional(),
});
export type SessionTurn = z.infer<typeof SessionTurnSchema>;

export const SessionRecordSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  workspaceUri: z.string().optional(),
  taskIds: z.array(z.string()).optional(),
  turns: z.array(SessionTurnSchema).optional(),
});export type SessionRecord = z.infer<typeof SessionRecordSchema>;

/** Stats record for tracking research agent outcomes */
export const StatsRecordSchema = z.object({
  agent_id: z.string().min(1),
  model: z.string().nullable(),
  taskType: z.string().min(1),
  success: z.number().nonnegative(),
  total: z.number().nonnegative(),
});
export type StatsRecord = z.infer<typeof StatsRecordSchema>;

export type SessionViewMessage =
  | { type: 'loadSessions' }
  | { type: 'openProject' }
  | { type: 'newSession' }
  | { type: 'selectSession'; sessionId: string }
  | { type: 'deleteSession'; sessionId: string };

export function isSessionViewMessage(message: unknown): message is SessionViewMessage {
  if (typeof message !== 'object' || message === null || !('type' in message)) return false;
  if (message.type === 'loadSessions' || message.type === 'newSession' || message.type === 'openProject') return true;
  if ((message.type === 'selectSession' || message.type === 'deleteSession')
    && 'sessionId' in message && typeof message.sessionId === 'string' && message.sessionId.length > 0) {
    return true;
  }
  return false;
}


