import { z } from 'zod';
import { RouteSchema } from '../types';

/** Reuse the router's enum so a new task type cannot drift between the two. */
export const TaskTypeSchema = RouteSchema.shape.task_type;
export type TaskType = z.infer<typeof TaskTypeSchema>;

const Timestamp = z.string().min(1);
const Url = z.string().url();

export const ClaimSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(200),
  evidence: z.string().max(300),
  source_url: Url,
  fetched_at: Timestamp.nullable(),
  origin: z.enum(['docs', 'manual', 'seed']),
});
export type Claim = z.infer<typeof ClaimSchema>;

export const AgentIntegrationSchema = z.object({
  mode: z.enum(['cli-terminal', 'vscode-chat']),
  supportsModelFlag: z.union([z.boolean(), z.literal('unknown')]),
  supportsReasoningFlag: z.union([z.boolean(), z.literal('unknown')]),
});
export type AgentIntegration = z.infer<typeof AgentIntegrationSchema>;

export const AgentEntrySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  integration: AgentIntegrationSchema,
  strengths: z.array(ClaimSchema),
  limits: z.array(ClaimSchema),
  sources: z.array(z.string().min(1)),
  last_verified: Timestamp.nullable(),
});
export type AgentEntry = z.infer<typeof AgentEntrySchema>;

export const ModelEntrySchema = z.object({
  id: z.string().min(1),
  agent_id: z.string().min(1),
  name: z.string().min(1),
  strengths: z.array(ClaimSchema),
  limits: z.array(ClaimSchema),
  best_for: z.array(TaskTypeSchema),
  avoid_for: z.array(TaskTypeSchema),
  reasoning_levels: z.array(z.string().min(1)),
  context_window: ClaimSchema.nullable(),
  cost_note: ClaimSchema.nullable(),
  last_verified: Timestamp.nullable(),
});
export type ModelEntry = z.infer<typeof ModelEntrySchema>;

export const KnowledgeBaseSchema = z.object({
  version: z.number().int().nonnegative(),
  updated_at: Timestamp,
  agents: z.array(AgentEntrySchema),
  models: z.array(ModelEntrySchema),
}).superRefine((kb, ctx) => {
  const agents = new Set<string>();
  kb.agents.forEach((agent, index) => {
    if (agents.has(agent.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['agents', index, 'id'], message: `duplicate agent id "${agent.id}"` });
    }
    agents.add(agent.id);
  });
  const models = new Set<string>();
  kb.models.forEach((model, index) => {
    if (models.has(model.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['models', index, 'id'], message: `duplicate model id "${model.id}"` });
    }
    models.add(model.id);
  });
});
export type KnowledgeBase = z.infer<typeof KnowledgeBaseSchema>;

export const AvailabilitySchema = z.object({
  agents: z.array(z.string().min(1)),
  models: z.array(z.object({ agent_id: z.string().min(1), name: z.string().min(1) })),
});
export type Availability = z.infer<typeof AvailabilitySchema>;

export const KbSourcesSchema = z.object({
  _comment: z.string().optional(),
  allowed_domains: z.array(z.string().min(1)),
  sources: z.array(z.object({
    agent_id: z.string().min(1),
    url: Url,
    note: z.string().optional(),
  })),
});
export type KbSources = z.infer<typeof KbSourcesSchema>;

export const KbChangeSchema = z.object({
  time: Timestamp,
  reason: z.string().min(1),
});
export const KbChangelogSchema = z.array(KbChangeSchema);
export type KbChange = z.infer<typeof KbChangeSchema>;
