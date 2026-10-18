import * as vscode from 'vscode';

const TARGETS: Record<'chatgpt' | 'gemini', string> = {
  chatgpt: 'https://chatgpt.com/',
  gemini: 'https://gemini.google.com/app',
};

export function buildPlanPrompt(task: string, context: string): string {
  const sections = [
    'You are an expert software engineer. A developer needs a concrete implementation plan.',
    '',
    '## Task',
    task,
  ];
  if (context.trim()) {
    sections.push('', '## Project context', context);
  }
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

export async function planExternal(
  target: 'chatgpt' | 'gemini',
  task: string,
  context: string,
): Promise<void> {
  const prompt = buildPlanPrompt(task, context);
  try {
    await vscode.env.clipboard.writeText(prompt);
  } catch {
    void vscode.window.showErrorMessage('Baton could not copy the prompt to the clipboard.');
    return;
  }
  try {
    await vscode.env.openExternal(vscode.Uri.parse(TARGETS[target]));
  } catch {
    void vscode.window.showWarningMessage('Prompt copied, but Baton could not open the browser.');
    return;
  }
  void vscode.window.showInformationMessage('Prompt copied. Paste it in the chat.');
}

export async function readClipboard(): Promise<string> {
  try {
    return await vscode.env.clipboard.readText();
  } catch {
    void vscode.window.showErrorMessage('Baton could not read the clipboard.');
    return '';
  }
}
