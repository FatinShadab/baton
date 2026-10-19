import * as vscode from 'vscode';
import { openIntegratedBrowser } from './browser';

export type HandoffTarget = 'chatgpt' | 'gemini' | 'claude' | 'antigravity';
export type BrowserHandoffTarget = 'chatgpt' | 'gemini';
export type HandoffOutcome = { notice: string; externalTarget?: BrowserHandoffTarget };

const TARGETS: Record<BrowserHandoffTarget, string> = {
  chatgpt: 'https://chatgpt.com/',
  gemini: 'https://gemini.google.com/app',
};

const EXTENSIONS = {
  claude: 'anthropic.claude-code',
  antigravity: 'google.google-antigravity',
} as const;

export function handoffAvailability(): Record<keyof typeof EXTENSIONS, boolean> {
  return {
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
): Promise<HandoffOutcome> {
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
      return { notice: 'Prompt added to Claude Code. Review it before sending.' };
    }
    if (!copied) return { notice: 'Baton could not copy the prompt to the clipboard.' };
    if (target === 'antigravity' && installed.antigravity) {
      await vscode.commands.executeCommand('antigravity.panel.focus');
      return { notice: 'Antigravity opened. Paste the copied prompt into its chat.' };
    }
    if (target === 'claude' || target === 'antigravity') {
      return { notice: `${target === 'claude' ? 'Claude Code' : 'Antigravity'} is not installed. Prompt copied for manual use.` };
    }
    await openIntegratedBrowser(TARGETS[target]);
    return { notice: 'Opened in VS Code. Sign in if needed, then paste the copied prompt.', externalTarget: target };
  } catch {
    return copied && (target === 'chatgpt' || target === 'gemini')
      ? { notice: 'Prompt copied, but the integrated browser could not open. Use Open externally below.', externalTarget: target }
      : { notice: copied ? 'Prompt copied, but Baton could not open the target. Paste it manually.'
        : 'Baton could not open the target or copy the prompt.' };
  }
}

export async function openExternalHandoff(target: BrowserHandoffTarget): Promise<string> {
  try {
    await vscode.env.openExternal(vscode.Uri.parse(TARGETS[target]));
    return 'Opened the planning site externally. Paste the copied prompt there.';
  } catch {
    return 'Could not open the planning site externally. The prompt is still on your clipboard.';
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
