import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { search } from './memory';
import { currentProjectFolder } from './project';

const MAX_FILE_BYTES = 100 * 1024;
export const MAX_CONTEXT_CHARS = 6000;
const excluded = /^(?:\.env(?:\..*)?|.*\.(?:pem|key)|id_rsa.*|credentials.*|node_modules|\.git)$/i;
const gitExclusions = ['.env', '.env.*', '*.pem', '*.key', 'id_rsa*', 'credentials*', 'node_modules', '.git'];

export type ContextPart = { source: string; text: string };
export type BuiltContext = { text: string; sources: string[]; parts: ContextPart[]; workspaceUri?: string };

export function allowed(filename: string): boolean {
  return !filename.split(/[\\/]/).some((part) => excluded.test(part));
}

export async function safeFile(filename: string, root: string): Promise<string | undefined> {
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

export function gitPathspecs(): string[] {
  return ['.', ...gitExclusions.flatMap((name) => [
    `:(glob,icase,exclude)**/${name}`, `:(glob,icase,exclude)**/${name}/**`,
  ])];
}

async function gitSummary(root: string, command: 'status' | 'diff'): Promise<string> {
  const args = command === 'status' ? ['status', '--short', '--untracked-files=all', '--no-renames']
    : ['diff', '--stat', '--no-ext-diff', '--no-textconv', '--no-renames'];
  try {
    return await new Promise<string>((resolve) => {
      execFile('git', ['-c', 'core.quotePath=false', ...args, '--', ...gitPathspecs()], {
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
  const includedFiles = new Set<string>();
  const add = (source: string, content: string) => {
    if (content) parts.push({ source, text: `--- ${source} ---\n${content}` });
  };
  const editor = vscode.window.activeTextEditor;
  const folder = currentProjectFolder();
  try {
    if (folder?.uri.scheme === 'file') {
      const root = await realpath(folder.uri.fsPath);
      const mentioned = [...new Set(task.match(/\b[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:py|ts|tsx|js|jsx|json|html|css|md|go|rs|java|sh|yaml|yml)\b/gi) ?? [])]
        .filter(allowed).slice(0, 3);
      for (const name of mentioned) {
        const matches = await Promise.resolve(vscode.workspace.findFiles(`**/${name}`, '**/{.git,node_modules}/**', 5)).catch(() => [] as vscode.Uri[]);
        for (const uri of matches) {
          const owner = vscode.workspace.getWorkspaceFolder(uri);
          if (!owner || owner.uri.scheme !== 'file') continue;
          const ownerRoot = await realpath(owner.uri.fsPath).catch(() => undefined);
          if (!ownerRoot) continue;
          const file = await safeFile(uri.fsPath, ownerRoot);
          if (!file || includedFiles.has(file)) continue;
          try {
            const content = editor?.document.uri.fsPath === uri.fsPath
              ? editor.document.getText()
              : await readFile(file, { encoding: 'utf8', signal: AbortSignal.timeout(3000) });
            if (Buffer.byteLength(content, 'utf8') <= MAX_FILE_BYTES) {
              add(`${owner.name}/${path.relative(ownerRoot, file)}`, content.slice(0, 3500));
              includedFiles.add(file);
            }
          } catch { /* A named file may disappear while collecting context. */ }
        }
      }
      if (editor?.document.uri.scheme === 'file') {
        const file = await safeFile(editor.document.uri.fsPath, root);
        if (file && !includedFiles.has(file)) {
          const document = editor.document;
          // Also check unsaved editor content before selecting a snippet.
          if (Buffer.byteLength(document.getText(), 'utf8') <= MAX_FILE_BYTES) {
            const range = editor.selection.isEmpty
              ? new vscode.Range(0, 0, Math.min(149, document.lineCount - 1), Number.MAX_SAFE_INTEGER)
              : editor.selection;
            const excerpt = document.getText(range);
            add(`${file} (${editor.selection.isEmpty ? 'first 150 lines' : 'selection'})`, excerpt);
            includedFiles.add(file);
          }
        }
      }
      const readme = await safeFile(path.join(root, 'README.md'), root);
      if (readme && !includedFiles.has(readme)) {
        try {
          const content = await readFile(readme, { encoding: 'utf8', signal: AbortSignal.timeout(3000) });
          if (Buffer.byteLength(content, 'utf8') <= MAX_FILE_BYTES) add(`${folder.name}/README.md`, content.slice(0, 3000));
        } catch { /* Missing or unreadable README is optional. */ }
      }
      const files = await Promise.resolve(vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*'), '**/{.git,node_modules}/**', 120)).catch(() => [] as vscode.Uri[]);
      const names = files.map((uri) => path.relative(root, uri.fsPath)).filter(allowed).slice(0, 80);
      add(`${folder.name}: project files`, names.join('\n'));
      const [status, diff] = await Promise.all([gitSummary(root, 'status'), gitSummary(root, 'diff')]);
      add(`${folder.name}: git status --short`, status);
      add(`${folder.name}: git diff --stat`, diff);
    }
  } catch { /* Workspace failures must not prevent routing. */ }
  try {
    const hits = await search(task, 5);
    const workspaceParts = parts.splice(0);
    for (const hit of hits) {
      if (hit.meta?.workspaceUri === folder?.uri.toString()
        && allowed(hit.source) && Buffer.byteLength(hit.text, 'utf8') <= MAX_FILE_BYTES) add(hit.source, hit.text);
    }
    // Put relevant memories first so the final character cap keeps prior plans.
    parts.push(...workspaceParts);
  } catch { /* Memory is optional. */ }
  return { text: parts.map((part) => part.text).join('\n\n'), sources: parts.map((part) => part.source), parts,
    workspaceUri: folder?.uri.scheme === 'file' ? folder.uri.toString() : undefined };
}
