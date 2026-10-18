import { PolicyDecision, Route } from './types';

// Independently enforce this even when a model supplies a low-risk route.
const danger = /\b(delete|drop|deploy|prod(?:uction)?|secrets?|credentials?|migrate)\b|\bforce[\s-]+push\b|\brm\s+-rf\b/i;

export function decide(route: Route, task: string): PolicyDecision {
  const raised = danger.test(task) && route.risk_tier !== 'high';
  const gatedRoute: Route = { ...route, risk_tier: raised ? 'high' : route.risk_tier };
  if (!task.trim()) {
    return { route: gatedRoute, action: 'BLOCK', why: 'Enter a task before routing.' };
  }
  switch (gatedRoute.risk_tier) {
    case 'high':
      return {
        route: gatedRoute,
        action: 'MANUAL_ONLY',
        why: raised ? 'Danger keyword raised risk to high. Handle manually; never auto-run.'
          : 'High-risk tasks require manual handling; never auto-run.',
        overrode: raised,
      };
    case 'moderate':
      return { route: gatedRoute, action: 'CONFIRM', why: 'User confirmation is required before execution.', overrode: false };
    case 'low':
      return { route: gatedRoute, action: 'RUN', why: 'Low-risk task permitted by policy. Routing alone does not execute it.', overrode: false };
  }
}
