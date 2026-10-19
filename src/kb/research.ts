import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import type {
  AgentEntry,
  Availability,
  AvailabilityKind,
  Claim,
  KnowledgeBase,
  ModelEntry,
  TaskType,
} from './types';

export type RiskTier = 'low' | 'moderate' | 'high';

export type ResearchInput = {
  task: string;
  taskType?: TaskType;
  riskTier?: RiskTier;
  topN?: number;
  perAgentCap?: number;
};

export type Candidate = {
  agent_id: string;
  model: string | null;
  score: number;
  why: string[];
  unverified: boolean;
  stale: boolean;
  claim_ids: string[];
  /** Other availability spellings that collapsed into this candidate. */
  aliases: string[];
  /** Computed, never stored in the KB: true only when Baton has a launch adapter. */
  dispatchable: boolean;
};

/** One availability entry after collapsing duplicate spellings. */
export type AvailabilityGroup = {
  agent_id: string;
  name: string;
  kind: AvailabilityKind;
  aliases: string[];
  /** Position in availability.models, used to break score ties in file order. */
  order: number;
};

/** Everything researchAgents needs; the KB and availability are passed in, never fetched. */
export type ResearchDeps = {
  kb: KnowledgeBase;
  availability: Availability;
  globalStorageUri: { readonly fsPath: string };
  /** Injectable clock so stale scoring stays deterministic in scripts. */
  now?: Date;
};

const STALE_DAYS = 14;
const DAY_MS = 86_400_000;
const STATS_FILE = 'stats.json';
const DEFAULT_PER_AGENT_CAP = 3;
const NO_DATA_WHY = 'No model data yet: run Baton: Update Knowledge';
const UNMATCHED_WHY = 'Available, but no knowledge-base entry yet';
const ADVISORY_WHY = "Advisory only: Baton can't launch this agent yet";
const AUTO_WHY = 'Tool chooses the model automatically';
const KEYWORD_CAP = 3;
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'your', 'using',
  'can', 'not', 'are', 'was', 'has', 'have', 'all', 'any', 'but', 'our', 'you',
  'its', 'use', 'will', 'when', 'then', 'than', 'how', 'what', 'why',
]);

/** Agent ids with a launch adapter in this repository (CodexRunner in src/codex.ts). */
const DISPATCHABLE_AGENTS = new Set(['codex']);
const CONCRETE_KINDS = new Set<AvailabilityKind>(['model', 'auto']);

const StatsSchema = z.array(z.object({
  agent_id: z.string(),
  model: z.string().nullable(),
  taskType: z.string(),
  success: z.number().nonnegative(),
  total: z.number().nonnegative(),
}));
type StatRecord = z.infer<typeof StatsSchema>[number];

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const normalize = (value: string): string => value.trim().toLowerCase();

/** Lowercase, then drop every character that is not a-z or 0-9. */
export function normalizedAvailabilityKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isDispatchableAgent(agentId: string): boolean {
  return DISPATCHABLE_AGENTS.has(agentId);
}

/** Availability placeholders are never real model choices. */
function isPlaceholder(name: string): boolean {
  const value = name.trim();
  return !value || /^todo$/i.test(value) || /[<>]/.test(value);
}

/**
 * Collapse availability entries by (agent_id, normalized name).
 * The first spelling and kind win; later spellings become display aliases.
 */
export function dedupeAvailability(availability: Availability): AvailabilityGroup[] {
  const groups = new Map<string, AvailabilityGroup>();
  availability.models.forEach((entry, order) => {
    if (isPlaceholder(entry.name)) return;
    const key = `${entry.agent_id}\u0000${normalizedAvailabilityKey(entry.name)}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        agent_id: entry.agent_id,
        name: entry.name,
        kind: entry.kind ?? 'model',
        aliases: [],
        order,
      });
      return;
    }
    if (entry.name !== existing.name && !existing.aliases.includes(entry.name)) {
      existing.aliases.push(entry.name);
    }
  });
  return [...groups.values()];
}

/**
 * Aliases and modes are fallbacks: they only surface when an agent has no
 * concrete model or auto entry.
 */
export function selectAvailabilityGroups(groups: AvailabilityGroup[]): AvailabilityGroup[] {
  const hasConcrete = groups.some((group) => CONCRETE_KINDS.has(group.kind));
  return hasConcrete ? groups.filter((group) => CONCRETE_KINDS.has(group.kind)) : groups;
}

function words(text: string): Set<string> {
  const found = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return new Set(found.filter((word) => word.length >= 3 && !STOP_WORDS.has(word)));
}

function overlapCount(taskWords: Set<string>, claim: Claim): number {
  const claimWords = words(claim.text);
  let matches = 0;
  for (const word of taskWords) if (claimWords.has(word)) matches++;
  return matches;
}

function isLongContext(task: string): boolean {
  const lower = task.toLowerCase();
  return task.length > 4000 || lower.includes('whole repo') || lower.includes('entire codebase');
}

function isStale(lastVerified: string | null, now: Date): boolean {
  if (!lastVerified) return true;
  const time = Date.parse(lastVerified);
  return !Number.isFinite(time) || now.getTime() - time > STALE_DAYS * DAY_MS;
}

/** Missing, unreadable, or malformed stats simply mean "no nudge". */
async function loadStats(dir: string): Promise<StatRecord[]> {
  try {
    const raw = await readFile(path.join(dir, STATS_FILE), 'utf8');
    const parsed = StatsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function findStat(stats: StatRecord[], agentId: string, modelName: string | null, taskType?: TaskType): StatRecord | undefined {
  if (!taskType) return undefined;
  return stats.find((record) => record.agent_id === agentId
    && record.taskType === taskType
    && (modelName
      ? record.model !== null && normalize(record.model) === normalize(modelName)
      : record.model === null));
}

function matchModel(kb: KnowledgeBase, agentId: string, name: string): ModelEntry | undefined {
  const wanted = normalizedAvailabilityKey(name);
  return kb.models.find((model) => model.agent_id === agentId
    && normalizedAvailabilityKey(model.name) === wanted);
}

function scoreCandidate(
  agentId: string,
  agent: AgentEntry | undefined,
  group: AvailabilityGroup | null,
  model: ModelEntry | null,
  input: ResearchInput,
  taskWords: Set<string>,
  stats: StatRecord[],
  now: Date,
): Candidate {
  const dispatchable = isDispatchableAgent(agentId);
  const why: string[] = [];
  const claimIds: string[] = [];
  let score = 0;

  if (!dispatchable) why.push(ADVISORY_WHY);
  if (group?.kind === 'auto') why.push(AUTO_WHY);

  // Agent-level candidate: the agent has no availability model entries at all.
  if (!group) {
    let matched = 0;
    for (const claim of agent?.strengths ?? []) {
      if (matched >= KEYWORD_CAP) break;
      if (overlapCount(taskWords, claim) === 0) continue;
      score += 1;
      matched++;
      why.push(claim.text);
      claimIds.push(claim.id);
    }
    const stale = isStale(agent?.last_verified ?? null, now);
    if (stale) score -= 0.5;
    const claims = [...(agent?.strengths ?? []), ...(agent?.limits ?? [])];
    return {
      agent_id: agentId,
      model: null,
      score: Math.round(score * 100) / 100,
      why,
      unverified: !claims.some((claim) => claim.origin === 'docs' || claim.origin === 'manual'),
      stale,
      claim_ids: claimIds,
      aliases: [],
      dispatchable,
    };
  }

  // Availability row with no KB entry: no claims to score, but still worth showing.
  if (!model) {
    const stale = isStale(null, now);
    score -= 0.5;
    why.push(UNMATCHED_WHY);
    return {
      agent_id: agentId,
      model: group.name,
      score: Math.round(score * 100) / 100,
      why,
      unverified: true,
      stale,
      claim_ids: [],
      aliases: [...group.aliases],
      dispatchable,
    };
  }

  if (input.taskType) {
    if (model.best_for.includes(input.taskType)) {
      score += 3;
      why.push(`Knowledge base marks this model best for ${input.taskType}.`);
    }
    if (model.avoid_for.includes(input.taskType)) {
      score -= 3;
      why.push(`Knowledge base marks this model to avoid for ${input.taskType}.`);
    }
  }

  let matched = 0;
  for (const claim of model.strengths) {
    if (matched >= KEYWORD_CAP) break;
    if (overlapCount(taskWords, claim) === 0) continue;
    score += 1;
    matched++;
    why.push(claim.text);
    claimIds.push(claim.id);
  }

  if (isLongContext(input.task) && model.context_window) {
    score += 2;
    why.push(model.context_window.text);
    claimIds.push(model.context_window.id);
  }

  const stat = findStat(stats, agentId, model.name, input.taskType);
  if (stat && stat.total >= 3) {
    score += (stat.success / stat.total - 0.5) * 4;
    why.push(`Local stats: ${stat.success}/${stat.total} successes on ${stat.taskType}.`);
  }

  const stale = isStale(model.last_verified, now);
  if (stale) score -= 0.5;

  const claims = [
    ...(agent?.strengths ?? []),
    ...(agent?.limits ?? []),
    ...model.strengths,
    ...model.limits,
    ...(model.context_window ? [model.context_window] : []),
    ...(model.cost_note ? [model.cost_note] : []),
  ];

  return {
    agent_id: agentId,
    model: group.name,
    score: Math.round(score * 100) / 100,
    why,
    unverified: !claims.some((claim) => claim.origin === 'docs' || claim.origin === 'manual'),
    stale,
    claim_ids: claimIds,
    aliases: [...group.aliases],
    dispatchable,
  };
}

/**
 * Rank available agents/models against a task using only local data.
 * No network and no model calls: the same inputs always produce the same order.
 */
export async function researchAgents(input: ResearchInput, deps: ResearchDeps): Promise<Candidate[]> {
  const now = deps.now ?? new Date();
  const topN = Math.max(1, Math.floor(input.topN ?? 5));
  const perAgentCap = Math.max(1, Math.floor(input.perAgentCap ?? DEFAULT_PER_AGENT_CAP));
  const taskWords = words(input.task);
  const stats = await loadStats(deps.globalStorageUri.fsPath);
  const availableAgents = [...new Set(deps.availability.agents.map((id) => id.trim()).filter(Boolean))];
  const agentById = new Map(deps.kb.agents.map((agent) => [agent.id, agent] as const));
  const agentOrder = new Map(availableAgents.map((id, index) => [id, index] as const));

  const groupsByAgent = new Map<string, AvailabilityGroup[]>();
  for (const group of dedupeAvailability(deps.availability)) {
    const list = groupsByAgent.get(group.agent_id) ?? [];
    list.push(group);
    groupsByAgent.set(group.agent_id, list);
  }

  const ranked: Array<{ candidate: Candidate; order: number }> = [];
  for (const agentId of availableAgents) {
    const agent = agentById.get(agentId);
    const agentRank = agentOrder.get(agentId) ?? 0;

    // No model knowledge at all: still surface every available agent.
    if (deps.kb.models.length === 0) {
      const candidate = scoreCandidate(agentId, agent, null, null, input, taskWords, stats, now);
      candidate.score = 0;
      candidate.why.unshift(NO_DATA_WHY);
      ranked.push({ candidate, order: agentRank });
      continue;
    }

    const groups = selectAvailabilityGroups(groupsByAgent.get(agentId) ?? []);
    if (groups.length === 0) {
      ranked.push({
        candidate: scoreCandidate(agentId, agent, null, null, input, taskWords, stats, now),
        order: agentRank,
      });
      continue;
    }
    for (const group of groups) {
      ranked.push({
        candidate: scoreCandidate(agentId, agent, group, matchModel(deps.kb, agentId, group.name) ?? null, input, taskWords, stats, now),
        order: group.order,
      });
    }
  }

  ranked.sort((a, b) => b.candidate.score - a.candidate.score
    || a.order - b.order
    || compareText(a.candidate.agent_id, b.candidate.agent_id)
    || compareText(a.candidate.model ?? '', b.candidate.model ?? ''));

  const counts = new Map<string, number>();
  const result: Candidate[] = [];
  for (const entry of ranked) {
    const used = counts.get(entry.candidate.agent_id) ?? 0;
    if (used >= perAgentCap) continue;
    counts.set(entry.candidate.agent_id, used + 1);
    result.push(entry.candidate);
    if (result.length >= topN) break;
  }
  return result;
}
