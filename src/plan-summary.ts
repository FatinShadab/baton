import { PlanSummary, PlanSummarySchema } from './task-model';

const START = '<!-- BATON:SUMMARY:START -->';
const END = '<!-- BATON:SUMMARY:END -->';

export class PlanFormatError extends Error {}

// The template deliberately uses a small YAML subset: mappings, step lists,
// scalar lists, quoted/plain scalars, and inline string arrays.
function scalar(raw: string): string | string[] {
  const value = raw.replace(/\s+#.*$/, '').trim();
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    return inner ? inner.split(',').map((item) => String(scalar(item.trim()))) : [];
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function mapping(line: string): [string, string] {
  const match = /^([a-z_]+):(?:\s*(.*))?$/.exec(line.trim());
  if (!match) throw new PlanFormatError(`Summary YAML is invalid near: ${line.trim()}.`);
  return [match[1], match[2] ?? ''];
}

function parseSummaryYaml(input: string): unknown {
  const result: Record<string, unknown> = {};
  let section: 'steps' | 'risks' | undefined;
  let step: Record<string, unknown> | undefined;
  for (const source of input.split(/\r?\n/)) {
    if (!source.trim() || /^\s*#/.test(source)) continue;
    const indent = source.match(/^ */)![0].length;
    const line = source.trim();
    if (indent === 0) {
      const [key, raw] = mapping(line);
      if (key in result) throw new PlanFormatError(`Duplicate summary key: ${key}.`);
      section = key === 'steps' || key === 'risks' ? key : undefined;
      result[key] = section ? [] : scalar(raw);
      step = undefined;
    } else if (indent === 2 && line.startsWith('- ')) {
      if (section === 'risks') (result.risks as string[]).push(String(scalar(line.slice(2))));
      else if (section === 'steps') {
        const [key, raw] = mapping(line.slice(2));
        step = { [key]: scalar(raw) };
        (result.steps as object[]).push(step);
      } else throw new PlanFormatError(`Unexpected summary list item: ${line}.`);
    } else if (indent === 4 && section === 'steps' && step) {
      const [key, raw] = mapping(line);
      if (key in step) throw new PlanFormatError(`Duplicate step key: ${key}.`);
      step[key] = scalar(raw);
    } else throw new PlanFormatError(`Unsupported summary YAML indentation near: ${line}.`);
  }
  return result;
}

export function validatePlanSummaryStructure(summary: PlanSummary, planText: string): void {
  const ids = new Set<string>();
  for (const step of summary.steps) {
    if (ids.has(step.id)) throw new PlanFormatError(`Duplicate step ID: ${step.id}.`);
    ids.add(step.id);
    if (!step.plan_ref.startsWith('#') || !planText.split(/\r?\n/).some((line) => line.trim() === step.plan_ref.trim())) {
      throw new PlanFormatError(`${step.id} plan_ref heading does not exist: ${step.plan_ref}.`);
    }
  }
  for (const step of summary.steps) for (const dependency of step.depends_on) {
    if (!ids.has(dependency)) throw new PlanFormatError(`${step.id} depends_on references missing step ${dependency}.`);
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const byId = new Map(summary.steps.map((step) => [step.id, step]));
  const visit = (id: string): void => {
    if (active.has(id)) throw new PlanFormatError(`Dependency cycle includes ${id}.`);
    if (visited.has(id)) return;
    active.add(id);
    for (const dep of byId.get(id)!.depends_on) visit(dep);
    active.delete(id);
    visited.add(id);
  };
  for (const id of ids) visit(id);
}

export function parsePlanSummary(plan: string): PlanSummary {
  const start = plan.lastIndexOf(START);
  const end = plan.lastIndexOf(END);
  if (start < 0 || end < 0 || end <= start) throw new PlanFormatError('Add the BATON summary start and end markers.');
  if (plan.slice(end + END.length).trim()) throw new PlanFormatError('The BATON summary must be the final block.');
  const body = plan.slice(0, start);
  const parsed = PlanSummarySchema.safeParse(parseSummaryYaml(plan.slice(start + START.length, end)));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new PlanFormatError(`Summary ${issue.path.join('.') || 'root'}: ${issue.message}`);
  }
  const summary = parsed.data;
  validatePlanSummaryStructure(summary, body);
  return summary;
}

export const FORMAT_FIX_PROMPT = `Please end the plan with a BATON summary block using valid YAML. Each step needs id, title, type, complexity, depends_on, parallel_group, files, plan_ref, and acceptance. Use existing Markdown headings for plan_ref.`;
