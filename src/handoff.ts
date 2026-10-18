import * as vscode from 'vscode';

export type HandoffTarget = 'chatgpt' | 'gemini' | 'claude' | 'antigravity';

const TARGETS: Record<'chatgpt' | 'gemini', string> = {
  chatgpt: 'https://chatgpt.com/',
  gemini: 'https://gemini.google.com/app',
};

const EXTENSIONS = {
  chatgpt: 'openai.chatgpt',
  claude: 'anthropic.claude-code',
  antigravity: 'google.google-antigravity',
} as const;

export function handoffAvailability(): Record<keyof typeof EXTENSIONS, boolean> {
  return {
    chatgpt: Boolean(vscode.extensions.getExtension(EXTENSIONS.chatgpt)),
    claude: Boolean(vscode.extensions.getExtension(EXTENSIONS.claude)),
    antigravity: Boolean(vscode.extensions.getExtension(EXTENSIONS.antigravity)),
  };
}

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
  target: HandoffTarget,
  task: string,
  context: string,
): Promise<string> {
  const prompt = buildPlanPrompt(task, context);
  let copied = false;
  try {
    await vscode.env.clipboard.writeText(prompt);
    copied = true;
  } catch {
    // Claude Code can still receive its initial prompt directly.
  }

  const installed = handoffAvailability();
  try {
    if (target === 'claude' && installed.claude) {
      await vscode.commands.executeCommand('claude-vscode.editor.open', undefined, prompt);
      return 'Prompt added to Claude Code. Review it before sending.';
    }
    if (!copied) return 'Baton could not copy the prompt to the clipboard.';
    if (target === 'chatgpt' && installed.chatgpt) {
      await vscode.commands.executeCommand('chatgpt.openSidebar');
      return 'Codex opened. Paste the copied prompt into its chat.';
    }
    if (target === 'antigravity' && installed.antigravity) {
      await vscode.commands.executeCommand('antigravity.panel.focus');
      return 'Antigravity opened. Paste the copied prompt into its chat.';
    }
    if (target === 'claude' || target === 'antigravity') {
      return `${target === 'claude' ? 'Claude Code' : 'Antigravity'} is not installed. Prompt copied for manual use.`;
    }
    await vscode.env.openExternal(vscode.Uri.parse(TARGETS[target]));
    return 'Prompt copied. Paste it in the browser chat.';
  } catch {
    return copied ? 'Prompt copied, but Baton could not open the target. Paste it manually.'
      : 'Baton could not open the target or copy the prompt.';
  }
}

export async function readClipboard(): Promise<string> {
  try {
    return await vscode.env.clipboard.readText();
  } catch {
    void vscode.window.showErrorMessage('Baton could not read the clipboard.');
    return '';
  }
}
