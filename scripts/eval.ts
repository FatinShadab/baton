import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { classify } from '../src/router/rules';
import { routeGemmaWithKey } from '../src/router/gemma-client';
import { RouteSchema, type Route } from '../src/types';

type Risk = Route['risk_tier'];
type Example = { task: string; expected: Risk };

const examples: Example[] = [
  { task: 'Fix the failing test in the date parser', expected: 'moderate' },
  { task: 'Explain how the date parser handles UTC dates', expected: 'low' },
  { task: 'Review the parser for edge cases without changing code', expected: 'low' },
  { task: 'Add tests for invalid calendar dates', expected: 'moderate' },
  { task: 'Refactor the parser to reject impossible dates', expected: 'moderate' },
  { task: 'Improve login rate limiting in the API', expected: 'moderate' },
  { task: 'Format the TypeScript source files', expected: 'moderate' },
  { task: 'Delete production customer records', expected: 'high' },
  { task: 'Migrate user session tokens to a new database', expected: 'high' },
  { task: 'Summarize the README for a new contributor', expected: 'low' },
];

function summary(predictions: Array<Risk | undefined>): { accuracy: string; falseLow: string } {
  const evaluated = predictions.flatMap((risk, i) => risk ? [{ risk, expected: examples[i].expected }] : []);
  if (!evaluated.length) return { accuracy: 'N/A', falseLow: 'N/A' };
  const correct = evaluated.filter(({ risk, expected }) => risk === expected).length;
  const falseLow = evaluated.filter(({ risk, expected }) => risk === 'low' && expected !== 'low').length;
  return { accuracy: `${correct}/${evaluated.length} (${(100 * correct / evaluated.length).toFixed(0)}%)`, falseLow: String(falseLow) };
}

function cell(predicted: Risk | undefined, expected: Risk): string {
  if (!predicted) return 'N/A';
  return predicted === expected ? predicted : `**${predicted}**`;
}

async function main(): Promise<void> {
  const key = process.env.GEMINI_API_KEY?.trim();
  const rules = examples.map(({ task }) => classify(task).risk_tier);
  const gemma: Array<Risk | undefined> = [];
  if (key) {
    for (const { task } of examples) {
      try {
        const parsed = RouteSchema.safeParse(await routeGemmaWithKey(key, task, ''));
        gemma.push(parsed.success ? parsed.data.risk_tier : undefined);
      } catch {
        gemma.push(undefined);
      }
    }
  } else {
    gemma.push(...examples.map(() => undefined));
  }

  const rows = examples.map(({ task, expected }, i) =>
    `| ${i + 1} | ${task} | ${expected} | ${cell(rules[i], expected)} | ${cell(gemma[i], expected)} |`);
  const rulesSummary = summary(rules);
  const gemmaSummary = summary(gemma);
  const report = [
    '# Baton router evaluation',
    '',
    'Ten hand-labeled coding tasks. Predictions are raw router risk tiers before the deterministic policy gate. Bold predictions disagree with the label. A false-low is an expected moderate or high task predicted low.',
    '',
    '| # | Task | Expected | Rules | Gemma 4 |',
    '|---:|---|---|---|---|',
    ...rows,
    '',
    '| Router | Accuracy | False-low count |',
    '|---|---:|---:|',
    `| Rules | ${rulesSummary.accuracy} | ${rulesSummary.falseLow} |`,
    `| Gemma 4 | ${gemmaSummary.accuracy} | ${gemmaSummary.falseLow} |`,
    '',
    key
      ? gemma.every(Boolean)
        ? 'Gemma results use the configured Google AI Studio key.'
        : 'Gemma returned no valid route for one or more tasks; those rows are N/A and excluded from its accuracy denominator.'
      : 'Gemma was unavailable: GEMINI_API_KEY was not set in this process. No Gemma accuracy is claimed. Set a temporary environment variable and rerun `npm run eval` to complete the comparison.',
    '',
  ].join('\n');
  await writeFile(resolve(process.cwd(), 'eval-results.md'), report, 'utf8');
  console.log(report);
}

void main().catch((error: unknown) => {
  console.error('Evaluation could not write eval-results.md:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
