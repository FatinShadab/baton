import * as vscode from 'vscode';

export const KEY_NAMES = ['GEMINI_API_KEY', 'OLLAMA_API_KEY', 'ELEVENLABS_API_KEY'] as const;
export type KeyName = typeof KEY_NAMES[number];

export async function getKey(secrets: vscode.SecretStorage, name: KeyName): Promise<string | undefined> {
  try {
    const val = await secrets.get(name);
    if (val?.trim()) return val.trim();
  } catch {
    // proceed to fallbacks
  }
  if (process.env[name]?.trim()) {
    return process.env[name]!.trim();
  }
  try {
    const folders = vscode.workspace.workspaceFolders;
    if (folders?.[0]) {
      const envUri = vscode.Uri.joinPath(folders[0].uri, '.env');
      const bytes = await vscode.workspace.fs.readFile(envUri);
      const text = Buffer.from(bytes).toString('utf8');
      const match = text.match(new RegExp(`^${name}\\s*=\\s*["']?([^"'\\r\\n]+)["']?`, 'm'));
      if (match?.[1]?.trim()) {
        const found = match[1].trim();
        void secrets.store(name, found);
        return found;
      }
    }
  } catch {
    // .env missing or unreadable
  }
  return undefined;
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
