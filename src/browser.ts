import * as vscode from 'vscode';

const OPEN_BROWSER = 'workbench.action.browser.open';

async function withinTimeout<T>(operation: Thenable<T>, timeoutMs = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve(operation), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('The VS Code browser did not respond.')), timeoutMs);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function openIntegratedBrowser(url: string): Promise<void> {
  const commands = await withinTimeout(vscode.commands.getCommands(true));
  if (!commands.includes(OPEN_BROWSER)) {
    throw new Error('The VS Code integrated browser is unavailable. Update VS Code and try again.');
  }
  await withinTimeout(vscode.commands.executeCommand(OPEN_BROWSER, url));
}
