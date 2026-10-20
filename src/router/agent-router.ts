import { Route, UserAgentConfig } from '../types';

export interface AgentRouteDecision {
  taskType: 'planning' | 'research' | 'implementation' | 'debugging' | 'testing' | 'review' | 'docs';
  agentKind: 'web' | 'local';
  selectedAgent: UserAgentConfig;
  confidence: 'high' | 'med' | 'low';
  reason: string;
  githubAttached: boolean;
  githubUrl?: string;
  recommendedModel?: string;
}

const PLANNING_PATTERNS = [
  /\b(plan|planning|architecture|architect|design|roadmap|strategy|breakdown|evaluate|uncertain|uncertainty|tradeoff|pros and cons|which is better|how should we|approach|from scratch|scaffold|scaffolding|blueprint)\b/i,
  /\b(how\s+(?:to|can|do|should)\s+(?:we|i)?\s*(?:build|develop|create|make|start|implement|structure|design|architect|setup))\b/i,
  /\b(want\s+to\s+(?:develop|build|create|make|design))\b/i,
  /\b(how\s+(?:to|do\s+i|can\s+i))\b/i,
  /\b(best\s+(?:way|practice|approach|pattern|library|stack)\s+to)\b/i,
];

const RESEARCH_PATTERNS = [
  /\b(research|investigate|explore|find out|look up|documentation|docs|benchmark|compare|survey|analyze|study|learn)\b/i,
];

const REVIEW_DOCS_PATTERNS = [
  /\b(review|audit|critique|check code|pr review|summarize|documentation|readme|document|explain codebase)\b/i,
];

const LOCAL_CODE_PATTERNS = [
  /\b(fix|bug|patch|create file|edit|refactor|function|class|method|terminal|run|npm|test|unit test|compile|cli|exec|codex)\b/i,
  /\b(npm\s+(?:run\s+)?build|cargo\s+build|docker\s+build|compile|rebuild|build\s+(?:the\s+)?(?:project|repo|package|app|binary))\b/i,
  /\b(implement\s+(?:in|into|method|function|class|file|feature))\b/i,
];

/**
 * Classify a prompt into task type and preferred agent kind (web vs local).
 * Web agents excel at planning, uncertainty, research-and-do, and architectural reasoning.
 * Local agents excel at concrete file edits, test execution, CLI tasks, and direct implementation.
 */
export function classifyPromptIntent(text: string): {
  taskType: AgentRouteDecision['taskType'];
  agentKind: 'web' | 'local';
  confidence: 'high' | 'med' | 'low';
  rationale: string;
} {
  const clean = text.trim();

  // 1. Check for planning & uncertainty (ideation, how-to, architecture)
  for (const pattern of PLANNING_PATTERNS) {
    if (pattern.test(clean)) {
      return {
        taskType: 'planning',
        agentKind: 'web',
        confidence: 'high',
        rationale: 'Task involves planning, architectural decisions, or uncertainty, best suited for a Web Agent.',
      };
    }
  }

  // 2. Check for research & discovery
  for (const pattern of RESEARCH_PATTERNS) {
    if (pattern.test(clean)) {
      return {
        taskType: 'research',
        agentKind: 'web',
        confidence: 'high',
        rationale: 'Task requires research, external exploration, or documentation lookup, best handled by a Web Agent.',
      };
    }
  }

  // 3. Check for review / documentation
  for (const pattern of REVIEW_DOCS_PATTERNS) {
    if (pattern.test(clean)) {
      return {
        taskType: /\b(doc|readme)\b/i.test(clean) ? 'docs' : 'review',
        agentKind: 'web',
        confidence: 'med',
        rationale: 'Broad code review and high-level documentation are well handled by a Web Agent.',
      };
    }
  }

  // 4. Check for local code execution / edits
  for (const pattern of LOCAL_CODE_PATTERNS) {
    if (pattern.test(clean)) {
      const isRefactor = /\b(refactor|restructure)\b/i.test(clean);
      const isTest = /\b(test|spec)\b/i.test(clean);
      return {
        taskType: isTest ? 'testing' : isRefactor ? 'implementation' : 'debugging',
        agentKind: 'local',
        confidence: 'high',
        rationale: 'Direct code edits, terminal execution, and local file changes are best executed by a Local Agent.',
      };
    }
  }

  // Fallback: short queries default to local implementation, long detailed queries default to planning/web
  if (clean.length > 250) {
    return {
      taskType: 'planning',
      agentKind: 'web',
      confidence: 'med',
      rationale: 'Comprehensive multi-part prompt with ambiguity, recommended for a Web Agent to plan first.',
    };
  }

  return {
    taskType: 'implementation',
    agentKind: 'local',
    confidence: 'med',
    rationale: 'Concrete coding request, assigned to Local Agent for direct execution.',
  };
}

/**
 * Select the winning runner from strictly the user's configured agents.
 * Integrates intelligent LLM routing (Gemma / Ollama) when available, falling back to rules.
 * Never invents an agent not present in userAgents.
 */
export function routeToUserAgent(
  prompt: string,
  userAgents: UserAgentConfig[],
  contextSnippet?: string,
  llmRoute?: Route,
): AgentRouteDecision {
  const activeAgents = (userAgents && userAgents.length > 0)
    ? userAgents.filter((a) => a.enabled !== false)
    : [];

  if (activeAgents.length === 0) {
    throw new Error('No agents configured in Agent Directory. Add at least one agent in the Baton sidebar.');
  }

  // If LLM route (Gemma / Ollama) is provided, leverage its semantic task classification
  const isLlmWeb = llmRoute && (
    llmRoute.task_type === 'planning' ||
    llmRoute.task_type === 'research' ||
    llmRoute.task_type === 'review' ||
    llmRoute.task_type === 'docs' ||
    llmRoute.recommended_destination === 'chatgpt_web' ||
    llmRoute.recommended_destination === 'gemini_web'
  );

  const intent = llmRoute
    ? {
        taskType: llmRoute.task_type,
        agentKind: (isLlmWeb ? 'web' : 'local') as 'web' | 'local',
        confidence: 'high' as const,
        rationale: llmRoute.reason || (isLlmWeb
          ? 'Intelligent router classified task as planning/research, best suited for a Web Agent.'
          : 'Intelligent router classified task as direct code execution, assigned to a Local Agent.'),
      }
    : classifyPromptIntent(prompt);

  const promptLower = prompt.toLowerCase();

  // Check if user explicitly mentioned one of their configured agents by name or ID
  const directMention = activeAgents.find((agent) =>
    promptLower.includes(agent.name.toLowerCase()) ||
    promptLower.includes(agent.id.toLowerCase())
  );

  let selected: UserAgentConfig;
  let reason = intent.rationale;

  if (directMention) {
    selected = directMention;
    reason = `User specifically requested agent "${selected.name}" for this task.`;
  } else {
    // Filter agents matching the preferred kind ('web' vs 'local')
    const matchingKind = activeAgents.filter((a) => a.type === intent.agentKind);

    if (matchingKind.length > 0) {
      // If prompt is research, prefer agent with research in name or capabilities
      if (intent.taskType === 'research') {
        const researchAgent = matchingKind.find((a) =>
          /research|explore|gemini|search/i.test(a.name) ||
          a.capabilities?.includes('research')
        );
        selected = researchAgent || matchingKind[0];
      } else if (intent.taskType === 'planning') {
        const planAgent = matchingKind.find((a) =>
          /architect|plan|claude|chatgpt/i.test(a.name) ||
          a.capabilities?.includes('planning')
        );
        selected = planAgent || matchingKind[0];
      } else {
        selected = matchingKind[0];
      }
    } else {
      // Fallback: if no agent of preferred kind exists in user's roster, use the first available agent
      selected = activeAgents[0];
      reason = `${intent.rationale} (Fallback: No ${intent.agentKind} agent in roster, using ${selected.name}).`;
    }
  }

  // Parse recommended model if agent has comma-separated models
  let recommendedModel: string | undefined;
  if (selected.models) {
    const modelList = selected.models.split(',').map((m) => m.trim()).filter(Boolean);
    if (modelList.length > 0) {
      // Pick first or matching model
      recommendedModel = modelList[0];
    }
  }

  return {
    taskType: intent.taskType,
    agentKind: selected.type,
    selectedAgent: selected,
    confidence: intent.confidence,
    reason,
    githubAttached: Boolean(selected.githubAttached),
    githubUrl: selected.url,
    recommendedModel,
  };
}
