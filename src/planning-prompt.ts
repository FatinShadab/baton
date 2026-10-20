/** The prompt copied for external planning when a task has no prepared prompt. */
export function buildPlanPrompt(task: string, context: string): string {
  const sections = [
    'You are an expert software engineer. A developer needs a concrete implementation plan.',
    '',
    '## Task',
    task,
  ];
  if (context.trim()) sections.push('', '## Project context', context);
  sections.push(
    '',
    '## Instructions',
    'Return a numbered implementation plan that includes:',
    '1. Each file to create or change, with a brief description of the changes.',
    '2. Risks and edge cases to watch for.',
    '3. Suggested tests to verify the changes.',
    '',
    'Be specific and actionable. Do not include code unless it clarifies a non-obvious step.',
  );
  return sections.join('\n');
}
