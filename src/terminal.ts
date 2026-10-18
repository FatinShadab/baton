import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

const WINDOWS = process.platform === 'win32';
const POWERSHELL = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const RUN_TIMEOUT_MS = 30 * 60 * 1000;
// Prefer native/.cmd entry points over npm's PowerShell shim, which may be disabled by policy.
const RESOLVE_CODEX = "$batonCodex = Get-Command codex.exe,codex.cmd,codex -ErrorAction SilentlyContinue | Select-Object -First 1; " +
  "if (-not $batonCodex) { throw 'Codex CLI was not found.' }; ";

export function capture(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      execFile(command, args, { cwd, timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true, encoding: 'utf8' },
        (error, stdout) => error ? reject(error) : resolve(stdout));
    } catch (error) { reject(error); }
  });
}

export async function codexAvailable(cwd: string): Promise<boolean> {
  try {
    // A shell is needed for npm's .cmd/.ps1 shims on Windows. No task text enters this command.
    const version = WINDOWS
      ? await capture(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        '$ErrorActionPreference = "Stop"; ' + RESOLVE_CODEX + '& $batonCodex.Source --version; exit $LASTEXITCODE'], cwd)
      : await capture('codex', ['--version'], cwd);
    return /codex\S*\s+\d/i.test(version);
  } catch { return false; }
}

function quote(value: string): string {
  return WINDOWS ? `'${value.replace(/'/g, "''")}'` : `'${value.replace(/'/g, "'\"'\"'")}'`;
}

export async function preparePrompt(prompt: string): Promise<{ command: string; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'baton-codex-'));
  const filename = path.join(directory, 'prompt.txt');
  const cleanup = async () => {
    try { await unlink(filename); } catch { /* Already removed or locked by a closing process. */ }
    try { await rmdir(directory); } catch { /* Remove only this empty, Baton-created directory. */ }
  };
  try {
    await writeFile(filename, prompt, { encoding: 'utf8', mode: 0o600, signal: AbortSignal.timeout(5000) });
    const file = quote(filename);
    const dir = quote(directory);
    const command = WINDOWS
      ? `$ErrorActionPreference = 'Stop'; $OutputEncoding = [System.Text.UTF8Encoding]::new($false); ` +
        `try { ${RESOLVE_CODEX}Get-Content -LiteralPath ${file} -Raw -Encoding UTF8 | & $batonCodex.Source exec --sandbox workspace-write -; ` +
        `$batonExit = $LASTEXITCODE } catch { Write-Host $_; $batonExit = 1 } finally { ` +
        `Remove-Item -LiteralPath ${file} -Force -ErrorAction SilentlyContinue; ` +
        `Remove-Item -LiteralPath ${dir} -ErrorAction SilentlyContinue }; exit $batonExit`
      : `trap ${quote(`rm -f -- ${file}; rmdir -- ${dir}`)} EXIT; codex exec --sandbox workspace-write "$(cat ${file})"`;
    return { command, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/** Each terminal runs exactly one command, so its timeout cannot kill a reused user shell. */
export class BatonTerminals implements vscode.Disposable {
  private readonly active = new Map<vscode.Terminal, { timer: NodeJS.Timeout; cleanup: () => Promise<void> }>();
  private readonly closed = vscode.window.onDidCloseTerminal((terminal) => this.release(terminal));

  async open(name: string, cwd: vscode.Uri, command: string, cleanup: () => Promise<void> = async () => {}): Promise<void> {
    let terminal: vscode.Terminal | undefined;
    let startupTimer: NodeJS.Timeout | undefined;
    try {
      terminal = vscode.window.createTerminal({ name, cwd, isTransient: true,
        shellPath: WINDOWS ? POWERSHELL : '/bin/sh',
        shellArgs: WINDOWS ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command] : ['-c', command] });
      const created = terminal;
      const timer = setTimeout(() => {
        created.dispose();
        this.release(created);
        void vscode.window.showWarningMessage(`${name} stopped after 30 minutes. Review the terminal and mark the task's outcome.`);
      }, RUN_TIMEOUT_MS);
      this.active.set(created, { timer, cleanup });
      created.show();
      const pid = await Promise.race([created.processId, new Promise<undefined>((resolve) => {
        startupTimer = setTimeout(() => resolve(undefined), 5000);
      })]);
      if (!pid) throw new Error('Baton could not start the terminal.');
    } catch (error) {
      terminal?.dispose();
      if (terminal) this.release(terminal);
      await cleanup();
      throw error;
    } finally {
      if (startupTimer) clearTimeout(startupTimer);
    }
  }

  private release(terminal: vscode.Terminal): void {
    const entry = this.active.get(terminal);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.active.delete(terminal);
    void entry.cleanup().catch(() => {});
  }

  dispose(): void {
    this.closed.dispose();
    for (const terminal of this.active.keys()) {
      terminal.dispose();
      this.release(terminal);
    }
  }
}
