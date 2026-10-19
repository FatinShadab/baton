import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  dedupeAvailability,
  researchAgents,
  ResearchInput,
  selectAvailabilityGroups,
} from '../src/kb/research';
import { loadAvailability } from '../src/kb/store';
import type { Availability, Claim, KnowledgeBase } from '../src/kb/types';

/**
 * TEST DATA ONLY. Every agent, model, and claim below is fabricated to exercise
 * deterministic ranking; none of it describes a real product.
 */
const NOW = new Date('2026-10-19T12:00:00.000Z');

const claim = (id: string, text: string, origin: Claim['origin'] = 'docs'): Claim => ({
  id,
  text,
  evidence: '',
  source_url: 'https://example.com/fake-kb',
  fetched_at: '2026-10-18T00:00:00.000Z',
  origin,
});

const kb: KnowledgeBase = {
  version: 1,
  updated_at: '2026-10-19T00:00:00.000Z',
  agents: [
    {
      id: 'alpha',
      label: 'Fake Alpha',
      integration: { mode: 'cli-terminal', supportsModelFlag: true, supportsReasoningFlag: 'unknown' },
      strengths: [claim('a-1', 'Runs commands directly in the terminal')],
      limits: [],
      sources: [],
      last_verified: '2026-10-18T00:00:00.000Z',
    },
    {
      id: 'beta',
      label: 'Fake Beta',
      integration: { mode: 'cli-terminal', supportsModelFlag: 'unknown', supportsReasoningFlag: true },
      strengths: [],
      limits: [claim('b-1', 'Slow on very large diffs')],
      sources: [],
      last_verified: '2026-10-18T00:00:00.000Z',
    },
    {
      id: 'gamma',
      label: 'Fake Gamma',
      integration: { mode: 'vscode-chat', supportsModelFlag: false, supportsReasoningFlag: false },
      strengths: [],
      limits: [],
      sources: [],
      last_verified: null,
    },
    {
      id: 'codex',
      label: 'Fake Codex',
      integration: { mode: 'cli-terminal', supportsModelFlag: true, supportsReasoningFlag: 'unknown' },
      strengths: [],
      limits: [],
      sources: [],
      last_verified: '2026-10-18T00:00:00.000Z',
    },
    {
      id: 'delta',
      label: 'Fake Delta',
      integration: { mode: 'manual', supportsModelFlag: 'unknown', supportsReasoningFlag: 'unknown' },
      strengths: [],
      limits: [],
      sources: [],
      last_verified: null,
    },
  ],
  models: [
    {
      id: 'm-fast',
      agent_id: 'alpha',
      name: 'fake-fast',
      strengths: [
        claim('f-1', 'Fast small focused edits with clear diffs'),
        claim('f-2', 'Strong unit test generation'),
      ],
      limits: [claim('f-3', 'Weak at deep research synthesis', 'manual')],
      best_for: ['implementation', 'testing'],
      avoid_for: ['research'],
      reasoning_levels: ['low', 'medium'],
      context_window: claim('f-4', 'Context window 200k tokens'),
      cost_note: null,
      last_verified: '2026-10-18T00:00:00.000Z',
    },
    {
      id: 'm-deep',
      agent_id: 'beta',
      name: 'fake-deep',
      strengths: [
        claim('d-1', 'Deep security review of authentication changes'),
        claim('d-2', 'Careful multi-step planning and research summaries'),
      ],
      limits: [claim('d-3', 'Expensive per request')],
      best_for: ['research', 'planning', 'review'],
      avoid_for: ['implementation'],
      reasoning_levels: ['medium', 'high'],
      context_window: claim('d-4', 'Context window 1M tokens'),
      cost_note: claim('d-5', 'Costs noticeably more than the fast model'),
      last_verified: null,
    },
    {
      id: 'm-broad',
      agent_id: 'gamma',
      name: 'fake-broad',
      strengths: [],
      limits: [],
      best_for: ['debugging', 'review'],
      avoid_for: [],
      reasoning_levels: [],
      context_window: null,
      cost_note: null,
      last_verified: '2026-10-18T00:00:00.000Z',
    },
    {
      id: 'm-coder',
      agent_id: 'codex',
      name: 'fake-coder',
      strengths: [claim('c-1', 'Strong implementation and code editing')],
      limits: [],
      best_for: ['implementation'],
      avoid_for: [],
      reasoning_levels: ['medium'],
      context_window: claim('c-2', 'Context window 400k tokens'),
      cost_note: null,
      last_verified: '2026-10-18T00:00:00.000Z',
    },
  ],
};

const availability: Availability = {
  agents: ['alpha', 'beta', 'gamma', 'codex', 'delta', 'ghost', 'sigma'],
  models: [
    { agent_id: 'alpha', name: 'fake-fast', kind: 'model' },
    { agent_id: 'alpha', name: 'FAKE-FAST', kind: 'model' },
    { agent_id: 'alpha', name: 'alpha-one', kind: 'model' },
    { agent_id: 'alpha', name: 'alpha-two', kind: 'model' },
    { agent_id: 'alpha', name: 'alpha-three', kind: 'model' },
    { agent_id: 'alpha', name: 'alpha-four', kind: 'model' },
    { agent_id: 'beta', name: 'fake-deep', kind: 'model' },
    { agent_id: 'beta', name: 'fake-deep-alias', kind: 'alias' },
    { agent_id: 'beta', name: 'beta-one', kind: 'model' },
    { agent_id: 'beta', name: 'beta-two', kind: 'model' },
    { agent_id: 'gamma', name: 'Auto', kind: 'auto' },
    { agent_id: 'codex', name: 'fake-coder', kind: 'model' },
    { agent_id: 'codex', name: 'FAKE-CODER', kind: 'model' },
    { agent_id: 'delta', name: 'delta-alias', kind: 'alias' },
    { agent_id: 'delta', name: 'Delta Mode', kind: 'mode' },
    { agent_id: 'ghost', name: 'ghost-model', kind: 'model' },
  ],
};

const longTask = `Refactor the entire codebase to strict TypeScript. ${'Keep every module small and typed. '.repeat(120)}`;
const DEBUG_TOP_N = 12;

const tasks: Array<{ label: string; input: ResearchInput }> = [
  { label: 'implementation', input: { task: 'Add a small settings form and unit tests', taskType: 'implementation', riskTier: 'low', topN: DEBUG_TOP_N } },
  { label: 'debugging', input: { task: 'Debug the flaky login test in CI', taskType: 'debugging', riskTier: 'low', topN: DEBUG_TOP_N } },
  { label: 'planning', input: { task: 'Research the API migration and write a plan', taskType: 'planning', riskTier: 'moderate', topN: DEBUG_TOP_N } },
  { label: 'high-risk review', input: { task: 'Review the authentication and security changes before deploy', taskType: 'review', riskTier: 'high', topN: DEBUG_TOP_N } },
  { label: 'long-context', input: { task: longTask, taskType: 'implementation', riskTier: 'moderate', topN: DEBUG_TOP_N } },
];

const pad = (value: string | number, width: number): string =>
  String(value).padEnd(width).slice(0, width);
const flags = (candidate: { stale: boolean; unverified: boolean }): string =>
  [candidate.stale ? 'stale' : '', candidate.unverified ? 'unverified' : ''].filter(Boolean).join(',') || 'verified';

function showCandidates(candidates: Awaited<ReturnType<typeof researchAgents>>): void {
  console.log(`${pad('#', 3)}${pad('agent', 12)}${pad('model', 20)}${pad('score', 7)}${pad('flags', 18)}${pad('dispatch', 10)}${pad('aliases', 22)}why`);
  console.log('-'.repeat(150));
  candidates.forEach((candidate, rank) => {
    const why = candidate.why.join('; ') || '(no matching claims)';
    console.log(`${pad(rank + 1, 3)}${pad(candidate.agent_id, 12)}${pad(candidate.model ?? '-', 20)}${pad(candidate.score, 7)}${pad(flags(candidate), 18)}${pad(candidate.dispatchable ? 'yes' : 'no', 10)}${pad(candidate.aliases.join(', ') || '-', 22)}${why}`);
  });
}

type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
const check = (name: string, pass: boolean, detail: string): void => {
  checks.push({ name, pass, detail });
};

async function runChecks(storageRoot: string): Promise<void> {
  const deps = { kb, availability, globalStorageUri: { fsPath: storageRoot }, now: NOW };
  const base = await researchAgents({ task: 'zzz qqq', topN: DEBUG_TOP_N }, deps);
  const alpha = base.filter((candidate) => candidate.agent_id === 'alpha');
  const fast = alpha.filter((candidate) => candidate.model === 'fake-fast');

  check(
    'duplicate spellings collapse into one candidate',
    fast.length === 1 && fast[0].aliases.includes('FAKE-FAST'),
    `alpha/${fast[0]?.model ?? '-'} aliases=${JSON.stringify(fast[0]?.aliases ?? [])}`,
  );

  const beta = base.filter((candidate) => candidate.agent_id === 'beta');
  const hasAlias = beta.some((candidate) => candidate.model === 'fake-deep-alias');
  check(
    'alias kind hidden when a real model exists for that agent',
    !hasAlias && beta.some((candidate) => candidate.model === 'fake-deep'),
    `beta models=${JSON.stringify(beta.map((candidate) => candidate.model))}`,
  );

  const delta = base.filter((candidate) => candidate.agent_id === 'delta');
  check(
    'alias/mode fallback still appears when no model/auto exists',
    delta.some((candidate) => candidate.model === 'delta-alias')
      && delta.some((candidate) => candidate.model === 'Delta Mode'),
    `delta models=${JSON.stringify(delta.map((candidate) => candidate.model))}`,
  );

  check(
    'perAgentCap keeps at most 3 candidates per agent',
    alpha.length === 3 && alpha.length <= 3,
    `alpha kept ${alpha.length} of ${availability.models.filter((entry) => entry.agent_id === 'alpha').length} availability rows`,
  );

  const one = beta.findIndex((candidate) => candidate.model === 'beta-one');
  const two = beta.findIndex((candidate) => candidate.model === 'beta-two');
  check(
    'file order wins score ties',
    one >= 0 && two >= 0 && one < two,
    `beta-one rank ${one + 1}, beta-two rank ${two + 1}`,
  );

  const advisory = alpha.every((candidate) => !candidate.dispatchable
    && candidate.why.includes("Advisory only: Baton can't launch this agent yet"));
  const codex = base.find((candidate) => candidate.agent_id === 'codex' && candidate.model === 'fake-coder');
  check(
    'non-dispatchable agents are flagged',
    advisory && Boolean(codex?.dispatchable) && !codex?.why.includes("Advisory only: Baton can't launch this agent yet"),
    `alpha dispatchable=${alpha[0]?.dispatchable}, codex dispatchable=${codex?.dispatchable}`,
  );

  const auto = base.find((candidate) => candidate.agent_id === 'gamma');
  check(
    'auto kind is kept and labelled',
    Boolean(auto) && Boolean(auto?.why.includes('Tool chooses the model automatically')),
    `gamma model=${auto?.model ?? '-'} why=${JSON.stringify(auto?.why ?? [])}`,
  );

  const unmatched = base.find((candidate) => candidate.agent_id === 'ghost');
  check(
    'unmatched candidates say so',
    unmatched?.unverified === true
      && unmatched.why.includes('Available, but no knowledge-base entry yet'),
    `ghost why=${JSON.stringify(unmatched?.why ?? [])}`,
  );
}

async function reportRealAvailability(storageRoot: string): Promise<void> {
  const availabilityPath = { extensionUri: { fsPath: path.resolve(__dirname, '..') }, globalStorageUri: { fsPath: storageRoot } };
  const real = await loadAvailability(availabilityPath);
  const groups = dedupeAvailability(real);
  const agentIds = [...new Set([...real.agents, ...groups.map((group) => group.agent_id)])];

  console.log('\nreal kb/availability.json (dedupe preview, no ranking)');
  console.log(`${pad('agent', 16)}${pad('entries', 9)}${pad('unique', 8)}candidates`);
  console.log('-'.repeat(45));
  let totalEntries = 0;
  let totalUnique = 0;
  let totalCandidates = 0;
  for (const agentId of agentIds) {
    const entries = real.models.filter((entry) => entry.agent_id === agentId).length;
    const unique = groups.filter((group) => group.agent_id === agentId);
    const candidates = selectAvailabilityGroups(unique).length;
    totalEntries += entries;
    totalUnique += unique.length;
    totalCandidates += candidates;
    console.log(`${pad(agentId, 16)}${pad(entries, 9)}${pad(unique.length, 8)}${candidates}`);
  }
  console.log('-'.repeat(45));
  console.log(`${pad('TOTAL', 16)}${pad(totalEntries, 9)}${pad(totalUnique, 8)}${totalCandidates}`);
  const placeholders = real.models.filter((entry) => {
    const name = entry.name.trim();
    return !name || /^todo$/i.test(name) || /[<>]/.test(name);
  }).length;
  console.log(`placeholders skipped: ${placeholders}`);
}

async function main(): Promise<boolean> {
  const storageRoot = await mkdtemp(path.join(tmpdir(), 'baton-kb-query-'));
  console.log('showCandidates (debug table) — FAKE KB test data only.');
  console.log(`task chars: ${longTask.length}; availability rows: ${availability.models.length}; storage: ${storageRoot}`);
  try {
    for (const [index, entry] of tasks.entries()) {
      const candidates = await researchAgents(entry.input, {
        kb,
        availability,
        globalStorageUri: { fsPath: storageRoot },
        now: NOW,
      });
      const risk = entry.input.riskTier ?? '-';
      console.log(`\n#${index + 1} ${entry.label} | type=${entry.input.taskType ?? '-'} risk=${risk} | ${candidates.length} candidate(s)`);
      showCandidates(candidates);
    }

    console.log('\nchecks');
    await runChecks(storageRoot);
    for (const result of checks) {
      console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} — ${result.detail}`);
    }

    await reportRealAvailability(storageRoot);
    const failed = checks.filter((result) => !result.pass).length;
    console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
    return failed === 0;
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
}

void main().then((ok) => {
  if (!ok) process.exitCode = 1;
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
