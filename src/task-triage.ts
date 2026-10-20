import { Digest } from './task-digest';
import { Triage, TriageSchema } from './task-model';

export function heuristicTriage(task: string, digest: Digest): Triage | undefined {
  const clearVerb = /^(fix|add|update|rename|remove|change|document)\b/i.test(task.trim());
  const broad = /\b(architecture|redesign|migrate|refactor|multi-step|across|entire|whole)\b/i.test(task);
  if (clearVerb && !broad && digest.matchingFiles.length <= 2 && task.length < 240) return {
    needs_planning: false, reason: 'A focused change with a clear action.', complexity: 'low',
    platform: 'chatgpt', attach_files: digest.matchingFiles,
  };
  if (broad || digest.matchingFiles.length > 5) return {
    needs_planning: true, reason: 'The change spans multiple parts of the project.', complexity: 'high',
    platform: /\b(large|huge|many files|whole repo)\b/i.test(task) ? 'gemini' : 'claude',
    attach_files: digest.matchingFiles,
  };
  return undefined;
}

export async function triageTask(task: string, digest: Digest): Promise<Triage> {
  const heuristic = heuristicTriage(task, digest);
  if (heuristic) return heuristic;
  const prompt = `Decide whether this coding task needs an external planning step. Return only JSON with needs_planning boolean, reason string, complexity low|med|high, platform chatgpt|gemini|claude, attach_files array. Do not write a plan.`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { callJson } = await import('./router');
      const result = await callJson(prompt, `Task: ${task}\nDigest: ${digest.text}`, TriageSchema);
      return { ...result, attach_files: result.attach_files.filter((file) => digest.matchingFiles.includes(file)) };
    } catch { /* One retry, then deterministic fallback. */ }
  }
  return { needs_planning: true, reason: 'Planning is safer for an ambiguous task.', complexity: 'med',
    platform: 'chatgpt', attach_files: digest.matchingFiles };
}

export function planningPrompt(task: string, digest: Digest, triage: Triage, slug: string): string {
  return `Plan this coding task. Use the attached files and compact project digest.\n\n## Task\n${task}\n\n## Constraints\nDo not read or send .env, *.pem, *.key, id_rsa*, credentials*, node_modules, or .git.\n\n## Project digest\n${digest.text}\n\n## Available agents\n${digest.agents.join(', ')}\n\n## Available models\n${digest.models.join(', ')}\n\n## Platform\n${triage.platform}\n\n## Files to attach\n${triage.attach_files.join('\n') || '(none)'}\n\nWrite a concrete plan with clear Markdown headings for each step (for example: '## Step 1: Fix login' or '## Step 2: Add tests'). State the files, dependencies, and acceptance criteria for each step clearly.`;
}
