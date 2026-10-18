import * as vscode from 'vscode';

export const KEY_NAMES = ['GEMINI_API_KEY', 'OLLAMA_API_KEY', 'ELEVENLABS_API_KEY'] as const;
export type KeyName = typeof KEY_NAMES[number];

export async function getKey(secrets: vscode.SecretStorage, name: KeyName): Promise<string | undefined> {
  try {
    return await secrets.get(name);
  } catch {
    return undefined;
  }
}

export async function setKey(secrets: vscode.SecretStorage, name: KeyName, value: string): Promise<boolean> {
  if (!value.trim()) return false;
  try {
    await secrets.store(name, value.trim());
    return true;
  } catch {
    return false;
  }
}

export async function setKeys(secrets: vscode.SecretStorage): Promise<void> {
  let saved = 0;
  try {
    for (const name of KEY_NAMES) {
      const value = await vscode.window.showInputBox({
        title: `Baton: ${name}`,
        password: true,
        ignoreFocusOut: true,
        prompt: 'Stored securely in VS Code. Leave empty to keep the existing key.',
      });
      if (value === undefined) break;
      if (!value.trim()) continue;
      if (await setKey(secrets, name, value)) saved++;
      else void vscode.window.showErrorMessage(`Baton could not save ${name}. Please try again.`);
    }
    if (saved) void vscode.window.showInformationMessage(`Baton: ${saved} API key(s) saved.`);
  } catch {
    void vscode.window.showErrorMessage('Baton could not open the API key prompt. Please try again.');
  }
}
