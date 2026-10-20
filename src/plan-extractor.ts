import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import { PlanSummary, PlanSummarySchema } from './task-model';
import { validatePlanSummaryStructure, parsePlanSummary } from './plan-summary';

export function hashPlan(planText: string): string {
  return createHash('sha256').update(planText.trim()).digest('hex').slice(0, 16);
}

export type PlanSummaryExtractorFn = (
  systemPrompt: string,
  userPrompt: string,
  schema: typeof PlanSummarySchema,
) => Promise<PlanSummary>;

export async function extractOrGetPlanSummary(
  planText: string,
  taskSlug: string,
  cacheDir?: string,
  customCallJson?: PlanSummaryExtractorFn,
): Promise<{ summary: PlanSummary; cached: boolean }> {
  const hash = hashPlan(planText);
  let cacheFile: string | undefined;

  if (cacheDir) {
    await mkdir(cacheDir, { recursive: true });
    cacheFile = path.join(cacheDir, `${hash}.summary.json`);
    try {
      const cachedData = JSON.parse(await readFile(cacheFile, 'utf8'));
      const parsed = PlanSummarySchema.safeParse(cachedData);
      if (parsed.success) {
        validatePlanSummaryStructure(parsed.data, planText);
        return { summary: parsed.data, cached: true };
      }
    } catch {
      // Cache miss or invalidated, proceed to extract
    }
  }

  // Fast path: if the plan already contains a valid BATON summary block (e.g. from tests or prior template)
  if (planText.includes('<!-- BATON:SUMMARY:START -->') && planText.includes('<!-- BATON:SUMMARY:END -->')) {
    try {
      const summary = parsePlanSummary(planText);
      if (cacheFile) {
        await writeFile(cacheFile, JSON.stringify(summary, null, 2), 'utf8');
      }
      return { summary, cached: false };
    } catch {
      // If manual block had a syntax issue, fall through to intelligent layer
    }
  }

  // Intelligent layer extraction
  const systemPrompt = `Extract a structured plan summary from the markdown plan. Return strict JSON conforming to:
{
  "task": "${taskSlug}",
  "goal": "<one-sentence summary of the task goal>",
  "steps": [
    {
      "id": "S1",
      "title": "<step title>",
      "type": "code" | "refactor" | "test" | "docs" | "research" | "review",
      "complexity": "low" | "med" | "high",
      "depends_on": [],
      "parallel_group": "A",
      "files": ["path/to/file.ts"],
      "plan_ref": "<exact heading from markdown, e.g. '## Step 1'>",
      "acceptance": "<acceptance criteria for this step>"
    }
  ],
  "risks": ["<risk description>"]
}
Requirements:
1. Every step must have a unique sequential id (S1, S2, ...).
2. 'plan_ref' MUST match an existing Markdown heading line in the plan text (e.g. '## Step 1' or '### Phase 1').
3. 'depends_on' references must be valid step IDs. No dependency cycles.
4. Output valid JSON only, no markdown code block or prose.`;

  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const retryFeedback = attempt > 0 && lastError ? `\nPrevious extraction error: ${lastError.message}. Fix this error and return valid JSON.` : '';
      let result: PlanSummary;
      if (customCallJson) {
        result = await customCallJson(
          systemPrompt + retryFeedback,
          `Plan markdown:\n\n${planText.slice(0, 16000)}`,
          PlanSummarySchema,
        );
      } else {
        const { callJson } = await import('./router');
        result = await callJson(
          systemPrompt + retryFeedback,
          `Plan markdown:\n\n${planText.slice(0, 16000)}`,
          PlanSummarySchema,
        );
      }
      // Deterministic validation checks
      validatePlanSummaryStructure(result, planText);
      if (cacheFile) {
        await writeFile(cacheFile, JSON.stringify(result, null, 2), 'utf8');
      }
      return { summary: result, cached: false };
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw new Error(`Unable to extract a valid plan structure: ${lastError?.message || 'Validation failed'}`);
}
