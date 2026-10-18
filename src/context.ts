import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { searchMemory } from './memory';

const MAX_FILE_BYTES = 100 * 1024;
export const MAX_CONTEXT_CHARS = 6000;
const excluded = /^(?:\.env(?:\..*)?|.*\.(?:pem|key)|id_rsa.*|credentials.*|node_modules|\.git)$/i;
const gitExclusions = ['.env', '.env.*', '*.pem', '*.key', 'id_rsa*', 'credentials*', 'node_modules', '.git'];

export type ContextPart = { source: string; text: string };
export type BuiltContext = { text: string; sources: string[]; parts: ContextPart[] };

function allowed(filename: string): boolean {
  return !filename.split(/[\\/]/).some((part) => excluded.test(part));
}

async function safeFile(filename: string, root: string): Promise<string | undefined> {
  if (!allowed(filename)) return undefined;
  try {
    const resolved = await realpath(filename);
    const relative = path.relative(root, resolved);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
      || !allowed(resolved)) return undefined;
    const info = await stat(resolved);
    return info.isFile() && info.size <= MAX_FILE_BYTES ? resolved : undefined;
  } catch {
    return undefined;
  }
}

async function gitSummary(root: string, command: 'status' | 'diff'): Promise<string> {
  // Exclude sensitive paths before Git computes output, including nested files.
  const pathspecs = gitExclusions.flatMap((name) => [
    `:(glob,icase,exclude)**/${name}`, `:(glob,icase,exclude)**/${name}/**`,
  ]);
  const args = command === 'status' ? ['status', '--short', '--untracked-files=all', '--no-renames']
    : ['diff', '--stat', '--no-ext-diff', '--no-textconv', '--no-renames'];
  try {
    return await new Promise<string>((resolve) => {
      execFile('git', ['-c', 'core.quotePath=false', ...args, '--', '.', ...pathspecs], {
        cwd: root, timeout: 3000, maxBuffer: MAX_FILE_BYTES, windowsHide: true, encoding: 'utf8',
      }, (error, stdout) => resolve(error ? '' : stdout.trim()));
    });
  } catch {
    return '';
  }
}

export function selectContext(context: BuiltContext, sources: string[]): string {
  const included = new Set(sources);
  return context.parts.filter((part) => included.has(part.source))
    .map((part) => part.text).join('\n\n').slice(0, MAX_CONTEXT_CHARS);
}

/** Collect locally; parts preserve source boundaries for the sharing preview. */
export async function buildContext(task: string): Promise<BuiltContext> {
  const parts: ContextPart[] = [];
  const add = (source: string, content: string) => {
    if (content) parts.push({ source, text: `--- ${source} ---\n${content}` });
  };
  const editor = vscode.window.activeTextEditor;
  const folder = (editor && vscode.workspace.getWorkspaceFolder(editor.document.uri))
    ?? vscode.workspace.workspaceFolders?.[0];
  try {
    if (folder?.uri.scheme === 'file') {
      const root = await realpath(folder.uri.fsPath);
      const readme = await safeFile(path.join(root, 'README.md'), root);
      if (readme) {
        try {
          const content = await readFile(readme, { encoding: 'utf8', signal: AbortSignal.timeout(3000) });
          if (Buffer.byteLength(content, 'utf8') <= MAX_FILE_BYTES) add(`${folder.name}/README.md`, content.slice(0, 3000));
        } catch { /* Missing or unreadable README is optional. */ }
      }
      const [status, diff] = await Promise.all([gitSummary(root, 'status'), gitSummary(root, 'diff')]);
      add(`${folder.name}: git status --short`, status);
      add(`${folder.name}: git diff --stat`, diff);
      if (editor?.document.uri.scheme === 'file') {
        const file = await safeFile(editor.document.uri.fsPath, root);
        if (file) {
          const document = editor.document;
          // Also check unsaved editor content before selecting a snippet.
          if (Buffer.byteLength(document.getText(), 'utf8') <= MAX_FILE_BYTES) {
            const range = editor.selection.isEmpty
              ? new vscode.Range(0, 0, Math.min(149, document.lineCount - 1), Number.MAX_SAFE_INTEGER)
              : editor.selection;
            add(`${file} (${editor.selection.isEmpty ? 'first 150 lines' : 'selection'})`, document.getText(range));
          }
        }
      }
    }
  } catch { /* Workspace failures must not prevent routing. */ }
  try {
    for (const hit of (await searchMemory(task, 5)).slice(0, 5)) {
      if (allowed(hit.source) && Buffer.byteLength(hit.text, 'utf8') <= MAX_FILE_BYTES) add(hit.source, hit.text);
    }
  } catch { /* Memory is optional. */ }
  return { text: parts.map((part) => part.text).join('\n\n'), sources: parts.map((part) => part.source), parts };
}
