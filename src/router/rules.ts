import { Route } from '../types';

/** Agent ids that can serve as a coding destination for a route. */
export const CODING_DESTINATIONS = ['codex', 'antigravity', 'copilot'] as const;
export type CodingDestination = (typeof CODING_DESTINATIONS)[number];

export function isCodingDestination(value: string): value is CodingDestination {
  return (CODING_DESTINATIONS as readonly string[]).includes(value);
}

/** Rules-tier fallback: when both LLM tiers fail, use the KB's top candidate. */
export function withKbFallback(route: Route, candidate: { agent_id: string } | undefined): Route {
  if (!candidate || !isCodingDestination(candidate.agent_id)) return route;
  return { ...route, recommended_destination: candidate.agent_id };
}

const danger = /\b(delete|drop|deploy|prod(?:uction)?|secrets?|credentials?|migrate)\b|\bforce[\s-]+push\b|\brm\s+-rf\b/i;
const changes = /\b(implement|add|fix|refactor|build|change|update)\b/i;
const lowRisk = /\b(docs?|readme|comments?|format|explain|summarize)\b/i;
const research = /\b(research|investigate|explore|design|architecture|architectural|approach|compare|comparison|options|tradeoffs?)\b/i;
const vague = /\b(improve|better|help|something|somehow|optimize)\b/i;

export function classify(task: string): Route {
  const researchNeeded = research.test(task) || vague.test(task) || task.trim().split(/\s+/).length < 3;
  let taskType: Route['task_type'];
  if (/\b(research|investigate|explore|compare|comparison)\b/i.test(task)) taskType = 'research';
  else if (/\b(design|architecture|architectural|approach|plan|planning)\b/i.test(task)) taskType = 'planning';
  else if (/\b(docs?|readme|comments?|explain|summarize)\b/i.test(task)) taskType = 'docs';
  else if (/\b(debug|debugging|fix|bug|error|crash)\b/i.test(task)) taskType = 'debugging';
  else if (/\b(test|tests|testing|coverage)\b/i.test(task)) taskType = 'testing';
  else if (/\b(review|audit|inspect)\b/i.test(task)) taskType = 'review';
  else taskType = 'implementation';

  // Specific documentation requests beat generic change verbs; danger always wins.
  const risk: Route['risk_tier'] = danger.test(task) ? 'high'
    : lowRisk.test(task) ? 'low'
    : changes.test(task) ? 'moderate'
    : researchNeeded || taskType === 'review' || taskType === 'planning' ? 'low' : 'moderate';
  return {
    task_type: taskType,
    risk_tier: risk,
    recommended_destination: researchNeeded || taskType === 'research' ? 'chatgpt_web' : 'codex',
    research_needed: researchNeeded,
    reason: risk === 'high' ? 'Danger keyword detected; this task requires manual handling.'
      : risk === 'low' ? 'Documentation, explanation, research, or review task with no danger keywords.'
      : 'Code changes or an unrecognized task require confirmation.',
  };
}
