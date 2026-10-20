import { z } from 'zod';
import { deterministicScope } from './scope-rules';
export { deterministicScope } from './scope-rules';

const ScopeSchema = z.object({ same_task: z.boolean() }).strict();
export async function checkScope(goal: string, message: string): Promise<boolean> {
  const local = deterministicScope(goal, message);
  if (local !== 'borderline') return local === 'same';
  try {
    const { callJson } = await import('./router');
    const result = await callJson('Return only strict JSON {"same_task": boolean}. Decide whether the message refines the existing goal or starts a different goal.',
      `Goal: ${goal}\nMessage: ${message}`, ScopeSchema);
    return result.same_task;
  } catch { return false; }
}
