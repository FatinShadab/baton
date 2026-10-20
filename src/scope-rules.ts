const terms = (text: string) => new Set((text.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? [])
  .filter((word) => !['the', 'and', 'for', 'with', 'this', 'that', 'please', 'task', 'also'].includes(word)));

export function deterministicScope(goal: string, message: string): 'same' | 'drift' | 'borderline' {
  if (/^(also|separately|new thing|unrelated|another task|different task)\b/i.test(message.trim())) return 'drift';
  if (/^(clarify|correction|actually|update the plan|revise the plan|here is the plan|the plan|regarding this)\b/i.test(message.trim())) return 'same';
  const original = terms(goal);
  const incoming = terms(message);
  const overlap = [...incoming].filter((word) => original.has(word)).length;
  const originalFiles = [...goal.matchAll(/\b[\w.-]+\.[a-z]{1,6}\b/gi)].map((match) => match[0].toLowerCase());
  if (originalFiles.some((file) => message.toLowerCase().includes(file))) return 'same';
  if (overlap >= 2 || (incoming.size <= 3 && overlap >= 1)) return 'same';
  if (overlap === 0 && incoming.size >= 5) return 'drift';
  return 'borderline';
}
