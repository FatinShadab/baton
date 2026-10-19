import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { Disposable, ExtensionContext } from 'vscode';
import { z } from 'zod';
import { extractFacts, ProposedFact, ProposedFacts } from './extract';
import { fetchSource } from './fetch';
import { loadKB, loadSources, saveKB, undoLastKBChange } from './store';
import type { AgentEntry, Claim, KbSources, KnowledgeBase, ModelEntry } from './types';
import { isAllowedUrl } from './urlpolicy';

export type UpdateOptions = { agentId?: string; force?: boolean };

export type UpdateDeps = {
  readonly extensionUri: { readonly fsPath: string };
  readonly globalStorageUri: { readonly fsPath: string };
  sources: KbSources;
  now?: Date;
  /** Test seam: defaults to the Gemma/Ollama extractor. */
  extract?: typeof extractFacts;
};

export type FailedSource = { url: string; agent_id: string; error: string };
export type RejectedFact = { text: string; reason: string };

export type UpdateResult = {
  skipped: boolean;
  reason?: string;
  applied: boolean;
  staged?: KnowledgeBase;
  summary: string;
  accepted: number;
  rejected: number;
  added: number;
  changed: number;
  pages: number;
  failedSources: FailedSource[];
  extractionErrors: FailedSource[];
  acceptedExamples: string[];
  rejectedDetails: RejectedFact[];
};

const STATE_FILE = 'kb-update-state.json';
const THROTTLE_MS = 12 * 60 * 60 * 1000;
const STALE_KB_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_PAGES = 12;
const MAX_EXAMPLES = 10;
const MAX_MODEL_NAME = 60;
const MAX_EVIDENCE = 300;

const StateSchema = z.object({
  last_success: z.string().nullable().optional(),
  last_attempt: z.string().nullable().optional(),
});
type UpdateState = z.infer<typeof StateSchema>;

const normalize = (value: string): string => value.toLowerCase().replace(/\s+/g, ' ').trim();
const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

function isStateDateYoungerThan(iso: string | null | undefined, now: Date, ageMs: number): boolean {
  if (!iso) return false;
  const time = Date.parse(iso);
  return Number.isFinite(time) && now.getTime() - time < ageMs;
}

async function readState(deps: { globalStorageUri: { readonly fsPath: string } }): Promise<UpdateState> {
  try {
    const parsed = StateSchema.safeParse(JSON.parse(await readFile(path.join(deps.globalStorageUri.fsPath, STATE_FILE), 'utf8')));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

async function writeState(deps: { globalStorageUri: { readonly fsPath: string } }, patch: UpdateState): Promise<void> {
  try {
    const file = path.join(deps.globalStorageUri.fsPath, STATE_FILE);
    await mkdir(path.dirname(file), { recursive: true });
    const next = { ...await readState(deps), ...patch };
    const temporary = `${file}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    await rename(temporary, file);
  } catch {
    // Update throttling is best-effort; never fail the update for state I/O.
  }
}

function evidenceFailure(evidence: string, normalizedPage: string): string | undefined {
  if (!evidence.trim()) return 'empty evidence';
  if (evidence.length > MAX_EVIDENCE) return `evidence longer than ${MAX_EVIDENCE} characters`;
  return normalizedPage.includes(normalize(evidence)) ? undefined : 'evidence not found verbatim in the page';
}

function makeClaim(fact: ProposedFact, url: string, fetchedAt: string): Claim {
  const text = fact.text.trim();
  return {
    id: sha256(`${text}\u0000${url}`),
    text,
    evidence: fact.evidence,
    source_url: url,
    fetched_at: fetchedAt,
    origin: 'docs',
  };
}

type Counters = { added: number; changed: number };

/** Adds a claim unless the same text+source already exists; manual claims are never rewritten. */
function addClaim(list: Claim[], fact: ProposedFact, url: string, fetchedAt: string, counters: Counters): void {
  const claim = makeClaim(fact, url, fetchedAt);
  const existing = list.find((entry) => entry.id === claim.id);
  if (!existing) {
    list.push(claim);
    counters.added++;
    return;
  }
  if (existing.origin !== 'manual'
    && (existing.evidence !== claim.evidence || existing.fetched_at !== claim.fetched_at)) {
    existing.evidence = claim.evidence;
    existing.fetched_at = claim.fetched_at;
    counters.changed++;
  }
}

function findModel(kb: KnowledgeBase, agentId: string, name: string): ModelEntry | undefined {
  const wanted = name.toLowerCase();
  return kb.models.find((model) => model.agent_id === agentId && model.name.toLowerCase() === wanted);
}

function addUnion<T>(target: T[], incoming: T[], counters: Counters): void {
  for (const value of incoming) {
    if (target.includes(value)) continue;
    target.push(value);
    counters.added++;
  }
}

type VerifyTally = { accepted: number; rejected: number; touchedModel: boolean };

function mergePage(
  next: KnowledgeBase,
  agentId: string,
  facts: ProposedFacts,
  pageText: string,
  url: string,
  fetchedAt: string,
  counters: Counters,
  acceptedExamples: string[],
  rejectedDetails: RejectedFact[],
): VerifyTally {
  const normalizedPage = normalize(pageText);
  let accepted = 0;
  let rejected = 0;
  let touchedModel = false;

  const reject = (text: string, reason: string): void => {
    rejected++;
    rejectedDetails.push({ text, reason });
  };

  const agent = next.agents.find((entry) => entry.id === agentId);

  for (const model of facts.models) {
    const name = model.name.trim();
    if (!name || name.length > MAX_MODEL_NAME) {
      reject(`model "${name.slice(0, MAX_MODEL_NAME)}"`, `model name longer than ${MAX_MODEL_NAME} characters`);
      continue;
    }

    const acceptedStrengths: ProposedFact[] = [];
    const acceptedLimits: ProposedFact[] = [];
    for (const fact of model.strengths) {
      const reason = evidenceFailure(fact.evidence, normalizedPage);
      if (reason) reject(fact.text, reason);
      else { acceptedStrengths.push(fact); accepted++; }
    }
    for (const fact of model.limits) {
      const reason = evidenceFailure(fact.evidence, normalizedPage);
      if (reason) reject(fact.text, reason);
      else { acceptedLimits.push(fact); accepted++; }
    }

    const contextWindow = model.context_window
      && !evidenceFailure(model.context_window.evidence, normalizedPage)
      ? model.context_window : null;
    if (model.context_window && !contextWindow) {
      reject(model.context_window.text, evidenceFailure(model.context_window.evidence, normalizedPage) ?? 'invalid evidence');
    }
    const costNote = model.cost_note
      && !evidenceFailure(model.cost_note.evidence, normalizedPage)
      ? model.cost_note : null;
    if (model.cost_note && !costNote) {
      reject(model.cost_note.text, evidenceFailure(model.cost_note.evidence, normalizedPage) ?? 'invalid evidence');
    }

    if (!acceptedStrengths.length && !acceptedLimits.length && !contextWindow && !costNote) {
      reject(`model "${name}"`, 'no evidence-backed facts for this model');
      continue;
    }

    accepted += (contextWindow ? 1 : 0) + (costNote ? 1 : 0);

    let target = findModel(next, agentId, name);
    if (!target) {
      target = {
        id: `model-${sha256(`${agentId}\u0000${name.toLowerCase()}`).slice(0, 24)}`,
        agent_id: agentId,
        name,
        strengths: [],
        limits: [],
        best_for: [],
        avoid_for: [],
        reasoning_levels: [],
        context_window: null,
        cost_note: null,
        last_verified: null,
      };
      next.models.push(target);
      counters.added++;
    }
    touchedModel = true;

    for (const fact of acceptedStrengths) {
      addClaim(target.strengths, fact, url, fetchedAt, counters);
      acceptedExamples.push(`${agentId}/${name} strength: ${fact.text.trim()}`);
    }
    for (const fact of acceptedLimits) {
      addClaim(target.limits, fact, url, fetchedAt, counters);
      acceptedExamples.push(`${agentId}/${name} limit: ${fact.text.trim()}`);
    }
    if (contextWindow) {
      if (!target.context_window || target.context_window.origin !== 'manual') {
        if (target.context_window) counters.changed++;
        else counters.added++;
        target.context_window = makeClaim(contextWindow, url, fetchedAt);
        acceptedExamples.push(`${agentId}/${name} context window: ${contextWindow.text.trim()}`);
      }
    }
    if (costNote) {
      if (!target.cost_note || target.cost_note.origin !== 'manual') {
        if (target.cost_note) counters.changed++;
        else counters.added++;
        target.cost_note = makeClaim(costNote, url, fetchedAt);
        acceptedExamples.push(`${agentId}/${name} cost: ${costNote.text.trim()}`);
      }
    }
    addUnion(target.best_for, model.best_for, counters);
    addUnion(target.avoid_for, model.avoid_for, counters);
    addUnion(target.reasoning_levels, model.reasoning_levels, counters);
    target.last_verified = fetchedAt;
  }

  for (const fact of facts.agent_facts) {
    const reason = evidenceFailure(fact.evidence, normalizedPage);
    if (reason) {
      reject(fact.text, reason);
      continue;
    }
    if (!agent) {
      reject(fact.text, `agent "${agentId}" is not in the knowledge base`);
      continue;
    }
    accepted++;
    if (fact.kind === 'strength' || fact.kind === 'limit') {
      addClaim(fact.kind === 'strength' ? agent.strengths : agent.limits, fact, url, fetchedAt, counters);
      acceptedExamples.push(`${agentId} ${fact.kind}: ${fact.text.trim()}`);
    } else {
      if (typeof fact.value !== 'boolean') {
        reject(fact.text, 'flag fact is missing a boolean value');
        accepted--;
        continue;
      }
      const key = fact.kind === 'supportsModelFlag' ? 'supportsModelFlag' : 'supportsReasoningFlag';
      if (agent.integration[key] !== fact.value) {
        agent.integration[key] = fact.value;
        counters.changed++;
      }
      acceptedExamples.push(`${agentId} ${fact.kind}=${fact.value}: ${fact.text.trim()}`);
    }
    agent.last_verified = fetchedAt;
  }

  return { accepted, rejected, touchedModel };
}

function buildSummary(
  accepted: number,
  rejected: number,
  added: number,
  changed: number,
  pages: number,
  failed: number,
  extractionErrors: number,
  acceptedExamples: string[],
  rejectedDetails: RejectedFact[],
): string {
  const examples = [
    ...acceptedExamples.map((line) => `+ ${line}`),
    ...rejectedDetails.map((entry) => `- ${entry.text} (${entry.reason})`),
  ].slice(0, MAX_EXAMPLES);
  return [
    `Baton knowledge update: ${accepted} accepted, ${rejected} rejected, ${added} added, ${changed} changed.`,
    `Pages read: ${pages}; failed sources: ${failed}; extraction errors: ${extractionErrors}.`,
    ...examples,
  ].join('\n');
}

/**
 * Fetch listed sources, extract evidence-backed facts, verify them deterministically,
 * and merge them into a copy of the KB. Applies automatically only when safe;
 * otherwise returns a staged KB for explicit approval.
 */
export async function updateKnowledge(options: UpdateOptions, deps: UpdateDeps): Promise<UpdateResult> {
  const now = deps.now ?? new Date();
  const nowIso = now.toISOString();
  const state = await readState(deps);

  if (!options.force && isStateDateYoungerThan(state.last_success, now, THROTTLE_MS)) {
    return {
      skipped: true,
      reason: 'A successful knowledge update ran less than 12 hours ago.',
      applied: false,
      summary: 'Skipped: the knowledge base was updated less than 12 hours ago.',
      accepted: 0, rejected: 0, added: 0, changed: 0, pages: 0,
      failedSources: [], extractionErrors: [], acceptedExamples: [], rejectedDetails: [],
    };
  }

  const kb = await loadKB(deps);
  const entries = deps.sources.sources.filter((entry) => !options.agentId || entry.agent_id === options.agentId);
  const failedSources: FailedSource[] = [];
  let policyViolation = false;
  let pages = 0;
  let accepted = 0;
  let rejected = 0;
  const counters: Counters = { added: 0, changed: 0 };
  const acceptedExamples: string[] = [];
  const rejectedDetails: RejectedFact[] = [];
  const extractionErrors: FailedSource[] = [];
  const next: KnowledgeBase = JSON.parse(JSON.stringify(kb)) as KnowledgeBase;
  const extractor = deps.extract ?? extractFacts;

  for (const entry of entries) {
    if (pages >= MAX_PAGES) break;
    const check = isAllowedUrl(entry.url, deps.sources.allowed_domains, deps.sources.sources.map((source) => source.url));
    if (!check.ok) {
      policyViolation = true;
      failedSources.push({ url: entry.url, agent_id: entry.agent_id, error: check.reason ?? 'URL is not allowed' });
      continue;
    }

    const fetched = await fetchSource(entry.url, { globalStorageUri: deps.globalStorageUri, sources: deps.sources, now });
    if (!fetched.ok) {
      failedSources.push({ url: entry.url, agent_id: entry.agent_id, error: fetched.error ?? 'fetch failed' });
      continue;
    }

    const agent = kb.agents.find((candidate) => candidate.id === entry.agent_id);
    if (!agent) {
      extractionErrors.push({ url: entry.url, agent_id: entry.agent_id, error: 'agent is not in the knowledge base' });
      continue;
    }

    pages++;
    try {
      const facts = await extractor(agent, fetched.text, entry.url);
      const tally = mergePage(next, entry.agent_id, facts, fetched.text, entry.url, nowIso, counters, acceptedExamples, rejectedDetails);
      accepted += tally.accepted;
      rejected += tally.rejected;
      if (tally.touchedModel) {
        const agentEntry = next.agents.find((candidate) => candidate.id === entry.agent_id);
        if (agentEntry) agentEntry.last_verified = nowIso;
      }
    } catch (error) {
      extractionErrors.push({
        url: entry.url,
        agent_id: entry.agent_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const summary = buildSummary(accepted, rejected, counters.added, counters.changed, pages, failedSources.length, extractionErrors.length, acceptedExamples, rejectedDetails);
  const reason = `Knowledge update: ${accepted} verified facts from ${pages} pages${options.agentId ? ` for ${options.agentId}` : ''}.`;

  if (accepted > 0 && !policyViolation) {
    try {
      await saveKB(deps, next, reason);
      await writeState(deps, { last_success: nowIso });
      return {
        skipped: false, applied: true, summary, accepted, rejected,
        added: counters.added, changed: counters.changed, pages,
        failedSources, extractionErrors, acceptedExamples, rejectedDetails, reason,
      };
    } catch (error) {
      return {
        skipped: false,
        applied: false,
        staged: next,
        reason,
        summary: `${summary}\nApply failed: ${error instanceof Error ? error.message : String(error)}`,
        accepted, rejected,
        added: counters.added, changed: counters.changed, pages,
        failedSources, extractionErrors, acceptedExamples, rejectedDetails,
      };
    }
  }

  return {
    skipped: false,
    applied: false,
    staged: accepted > 0 ? next : undefined,
    reason,
    summary,
    accepted, rejected,
    added: counters.added, changed: counters.changed, pages,
    failedSources, extractionErrors, acceptedExamples, rejectedDetails,
  };
}

/** Command + toasts. updateKnowledge itself stays UI-free for scripts and background runs. */
export function registerUpdateCommand(context: ExtensionContext): Disposable[] {
  const vscode = require('vscode') as typeof import('vscode');

  const undoToast = async (summary: string): Promise<void> => {
    try {
      const choice = await vscode.window.showInformationMessage(summary, 'Undo');
      if (choice !== 'Undo') return;
      const undone = await undoLastKBChange(context);
      void vscode.window.showInformationMessage(undone
        ? 'Baton restored the previous knowledge base.'
        : 'Baton had no previous knowledge base to restore.');
    } catch {
      void vscode.window.showErrorMessage('Baton could not undo the knowledge update.');
    }
  };

  const run = async (): Promise<void> => {
    try {
      const sources = await loadSources(context);
      const result = await updateKnowledge({ force: true }, {
        extensionUri: context.extensionUri,
        globalStorageUri: context.globalStorageUri,
        sources,
      });

      if (result.skipped) {
        void vscode.window.showInformationMessage(result.summary);
        return;
      }

      if (result.staged) {
        const choice = await vscode.window.showInformationMessage(
          `${result.summary}\n\nReview this update before applying.`, 'Apply', 'Discard');
        if (choice === 'Apply') {
          try {
            await saveKB(context, result.staged, result.reason ?? 'Approved knowledge update');
          } catch (error) {
            void vscode.window.showErrorMessage(`Baton could not apply the update: ${error instanceof Error ? error.message : String(error)}`);
            return;
          }
          await undoToast(result.summary);
        } else if (choice === 'Discard') {
          void vscode.window.showInformationMessage('Baton discarded the staged knowledge update.');
        }
        return;
      }

      if (result.applied) {
        await undoToast(result.summary);
        return;
      }

      void vscode.window.showWarningMessage(result.summary);
    } catch (error) {
      void vscode.window.showErrorMessage(`Baton could not update knowledge: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return [vscode.commands.registerCommand('baton.kb.update', run)];
}

function today(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Once per day, if the KB is older than 14 days, refresh it silently.
 * No popups: background failures go to the extension log only.
 */
export async function maybeRunDailyUpdate(context: ExtensionContext): Promise<void> {
  try {
    const now = new Date();
    const kb = await loadKB(context);
    if (isStateDateYoungerThan(kb.updated_at, now, STALE_KB_MS)) return;

    const state = await readState(context);
    if (state.last_attempt === today(now)) return;
    await writeState(context, { last_attempt: today(now) });

    const sources = await loadSources(context);
    const result = await updateKnowledge({}, {
      extensionUri: context.extensionUri,
      globalStorageUri: context.globalStorageUri,
      sources,
      now,
    });
    console.log(`[Baton] background knowledge update: ${result.summary.split('\n')[0]}`);
  } catch (error) {
    console.log(`[Baton] background knowledge update skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
}
