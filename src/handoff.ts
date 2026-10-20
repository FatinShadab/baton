import type * as vscode from 'vscode';
import { openIntegratedBrowser } from './browser';
import { buildPlanPrompt } from './planning-prompt';

function getVsCode(): typeof vscode | undefined {
  try {
    return require('vscode');
  } catch {
    return undefined;
  }
}

export type HandoffTarget = 'chatgpt' | 'gemini' | 'claude' | 'antigravity';
export type BrowserHandoffTarget = 'chatgpt' | 'gemini' | 'claude';
export type HandoffOutcome = { notice: string; externalTarget?: BrowserHandoffTarget };

export const TARGETS: Record<BrowserHandoffTarget, string> = {
  chatgpt: 'https://chatgpt.com/',
  gemini: 'https://gemini.google.com/app',
  claude: 'https://claude.ai/new',
};

const EXTENSIONS = {
  antigravity: 'google.google-antigravity',
} as const;

export function handoffAvailability(): Record<keyof typeof EXTENSIONS, boolean> {
  const vsc = getVsCode();
  return {
    antigravity: Boolean(vsc?.extensions.getExtension(EXTENSIONS.antigravity)),
  };
}

export async function planExternal(
  target: HandoffTarget,
  task: string,
  context: string,
  preparedPrompt?: string,
): Promise<HandoffOutcome> {
  const prompt = preparedPrompt ?? buildPlanPrompt(task, context);
  let copied = false;
  const vsc = getVsCode();
  try {
    if (vsc) {
      await vsc.env.clipboard.writeText(prompt);
      copied = true;
    }
  } catch {
    // Claude Code can still receive its initial prompt directly.
  }

  const installed = handoffAvailability();
  try {
    if (!copied) return { notice: 'Baton could not copy the prompt to the clipboard.' };
    if (target === 'antigravity' && installed.antigravity && vsc) {
      await vsc.commands.executeCommand('antigravity.panel.focus');
      return { notice: 'Antigravity opened. Paste the copied prompt into its chat.' };
    }
    if (target === 'antigravity') {
      return { notice: 'Antigravity is not installed. Prompt copied for manual use.' };
    }
    await openIntegratedBrowser(TARGETS[target]);
    return { notice: 'Opened in VS Code. Sign in if needed, then paste the copied prompt.', externalTarget: target };
  } catch {
    return copied && (target === 'chatgpt' || target === 'gemini' || target === 'claude')
      ? { notice: 'Prompt copied, but the integrated browser could not open. Use Open externally below.', externalTarget: target }
      : { notice: copied ? 'Prompt copied, but Baton could not open the target. Paste it manually.'
        : 'Baton could not open the target or copy the prompt.' };
  }
}

export async function openExternalHandoff(target: BrowserHandoffTarget): Promise<string> {
  const vsc = getVsCode();
  try {
    if (vsc) {
      await vsc.env.openExternal(vsc.Uri.parse(TARGETS[target]));
      return 'Opened the planning site externally. Paste the copied prompt there.';
    }
    return 'Could not open the planning site externally. The prompt is still on your clipboard.';
  } catch {
    return 'Could not open the planning site externally. The prompt is still on your clipboard.';
  }
}

export async function readClipboard(): Promise<string> {
  const vsc = getVsCode();
  try {
    if (vsc) {
      return await vsc.env.clipboard.readText();
    }
    return '';
  } catch {
    if (vsc) {
      void vsc.window.showErrorMessage('Baton could not read the clipboard.');
    }
    return '';
  }
}
