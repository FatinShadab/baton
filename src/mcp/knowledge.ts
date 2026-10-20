import * as path from 'node:path';
import { loadAvailability, loadKB } from '../kb/store';
import type { AgentEntry, Claim, KnowledgeBase, ModelEntry } from '../kb/types';

function context() {
  const extensionRoot = process.env.BATON_EXTENSION_ROOT;
  const memoryPath = process.env.BATON_MEMORY_PATH;
  if (!extensionRoot || !path.isAbsolute(extensionRoot)
    || !memoryPath || !path.isAbsolute(memoryPath) || path.basename(memoryPath).toLowerCase() !== 'memory.json') {
    throw new Error('Baton MCP needs absolute BATON_EXTENSION_ROOT and BATON_MEMORY_PATH paths. Copy a fresh MCP config from Baton.');
  }
  return {
    extensionUri: { fsPath: path.resolve(extensionRoot) },
    globalStorageUri: { fsPath: path.dirname(path.resolve(memoryPath)) },
  };
}

function getKB(): Promise<KnowledgeBase> { return loadKB(context()); }

/** A compact index lets a client discover IDs before asking for detailed claims. */
export async function getKnowledgeBaseOverview(): Promise<unknown> {
  const ctx = context();
  const [kb, availability] = await Promise.all([loadKB(ctx), loadAvailability(ctx)]);
  return {
    version: kb.version,
    updated_at: kb.updated_at,
    availability,
    agents: kb.agents.map((agent) => ({
      id: agent.id, label: agent.label, integration: agent.integration,
      model_count: kb.models.filter((model) => model.agent_id === agent.id).length,
      last_verified: agent.last_verified,
    })),
    models: kb.models.map((model) => ({ id: model.id, agent_id: model.agent_id, name: model.name,
      best_for: model.best_for, avoid_for: model.avoid_for, last_verified: model.last_verified })),
  };
}

export async function getAgentKnowledge(agentId: string): Promise<unknown> {
  const kb = await getKB();
  const agent = kb.agents.find((entry) => entry.id === agentId);
  if (!agent) return null;
  return { updated_at: kb.updated_at, agent, models: kb.models.filter((model) => model.agent_id === agentId) };
}

type Hit = { type: 'agent' | 'model' | 'claim'; agent_id: string; model_id?: string;
  label: string; score: number; text?: string; source_url?: string; fetched_at?: string | null; origin?: string };

function score(value: string, terms: string[]): number {
  const text = value.toLowerCase();
  return terms.reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0);
}

function claimHits(claims: Claim[], agentId: string, label: string, terms: string[], modelId?: string): Hit[] {
  return claims.flatMap((claim) => {
    const relevance = score(`${claim.text} ${label}`, terms);
    return relevance ? [{ type: 'claim', agent_id: agentId, model_id: modelId, label,
      score: relevance, text: claim.text, source_url: claim.source_url,
      fetched_at: claim.fetched_at, origin: claim.origin } as Hit] : [];
  });
}

function agentHits(agent: AgentEntry, terms: string[]): Hit[] {
  const label = `${agent.label} (${agent.id})`;
  const relevance = score(`${label} ${agent.integration.mode}`, terms);
  return [
    ...(relevance ? [{ type: 'agent', agent_id: agent.id, label, score: relevance } as Hit] : []),
    ...claimHits([...agent.strengths, ...agent.limits], agent.id, label, terms),
  ];
}

function modelHits(model: ModelEntry, terms: string[]): Hit[] {
  const label = `${model.name} (${model.agent_id})`;
  const relevance = score(`${label} ${model.best_for.join(' ')} ${model.avoid_for.join(' ')} ${model.reasoning_levels.join(' ')}`, terms);
  return [
    ...(relevance ? [{ type: 'model', agent_id: model.agent_id, model_id: model.id, label,
      score: relevance, } as Hit] : []),
    ...claimHits([
      ...model.strengths, ...model.limits,
      ...(model.context_window ? [model.context_window] : []),
      ...(model.cost_note ? [model.cost_note] : []),
    ], model.agent_id, label, terms, model.id),
  ];
}

export async function searchKnowledgeBase(query: string): Promise<Hit[]> {
  const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}._-]*/gu) ?? [])].slice(0, 12);
  if (!terms.length) return [];
  const kb = await getKB();
  return [...kb.agents.flatMap((agent) => agentHits(agent, terms)),
    ...kb.models.flatMap((model) => modelHits(model, terms))]
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, 20);
}
