import * as vscode from 'vscode';

export async function setKeys(secrets: vscode.SecretStorage): Promise<void> {
  const provider = await vscode.window.showQuickPick(
    ['Google AI Studio', 'Ollama Cloud'],
    { placeHolder: 'Choose the API key to set' },
  );
  if (!provider) return;

  const key = await vscode.window.showInputBox({
    title: `Baton: ${provider} API key`,
    password: true,
    ignoreFocusOut: true,
    prompt: 'Stored securely in VS Code SecretStorage.',
  });
  if (!key?.trim()) return;

  try {
    await secrets.store(provider === 'Google AI Studio' ? 'baton.googleApiKey' : 'baton.ollamaApiKey', key.trim());
    void vscode.window.showInformationMessage(`Baton: ${provider} key saved.`);
  } catch {
    void vscode.window.showErrorMessage('Baton could not save the API key. Please try again.');
  }
}
