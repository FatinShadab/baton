import { execFile } from 'node:child_process';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { allowed } from './path-policy';

export type Digest = { text: string; matchingFiles: string[]; agents: string[]; models: string[] };
const DEFAULT_AGENTS = ['codex', 'antigravity', 'copilot'];
const DEFAULT_MODELS = ['gpt-6.1-sol', 'gemini-4-argon'];

async function tree(root: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > 3 || files.length >= 100) return;
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      if (!allowed(entry.name) || entry.name === 'dist' || entry.name === 'state') continue;
      const relative = path.relative(root, path.join(directory, entry.name));
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), depth + 1);
      else if (entry.isFile()) files.push(relative);
      if (files.length >= 100) break;
    }
  };
  await walk(root, 0);
  return files;
}

function gitStatus(root: string): Promise<string> {
  return new Promise((resolve) => {
    try {
      execFile('git', ['status', '--short', '--untracked-files=no'],
        { cwd: root, timeout: 3000, maxBuffer: 8192, windowsHide: true },
        (error, output) => resolve(error ? '' : output.trim().split('\n').filter((line) => allowed(line.slice(3))).slice(0, 30).join('\n')));
    } catch { resolve(''); }
  });
}

export async function projectDigest(root: string, project: string, availability?: { agents: string[]; models: string[] }): Promise<Digest> {
  const cache = path.join(project, 'digest.json');
  try { return JSON.parse(await readFile(cache, 'utf8')) as Digest; } catch { /* Rebuild once. */ }
  const files = await tree(root);
  const projectNotes = await readFile(path.join(project, 'project.md'), 'utf8').catch(() => '');
  const digest: Digest = {
    text: `Project: ${path.basename(root)}\nProject preferences and constraints:\n${projectNotes.slice(0, 550)}\nFiles (depth 3):\n${files.join('\n').slice(0, 1000)}\nAgents: ${(availability?.agents ?? DEFAULT_AGENTS).join(', ')}\nModels: ${(availability?.models ?? DEFAULT_MODELS).join(', ')}`.slice(0, 2200),
    matchingFiles: [], agents: availability?.agents ?? DEFAULT_AGENTS, models: availability?.models ?? DEFAULT_MODELS,
  };
  await writeFile(cache, JSON.stringify(digest, null, 2), 'utf8');
  return digest;
}

export async function taskDigest(root: string, project: string, task: string, availability?: { agents: string[]; models: string[] }): Promise<Digest> {
  const base = await projectDigest(root, project, availability);
  const files = await tree(root);
  const words = new Set(task.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? []);
  const matching = files.filter((file) => [...words].some((word) => file.toLowerCase().includes(word))).slice(0, 8);
  const sizes = await Promise.all(matching.map(async (file) => {
    const info = await stat(path.join(root, file)).catch(() => undefined);
    if (!info) return file;
    const content = info.size <= 100 * 1024 ? await readFile(path.join(root, file), 'utf8').catch(() => '') : '';
    const lines = content ? content.split(/\r?\n/).length : '?';
    return `${file} (${info.size} bytes, ${lines} lines)`;
  }));
  const status = await gitStatus(root);
  return { ...base, matchingFiles: matching,
    text: `${base.text}\nGit status:\n${status || '(clean or unavailable)'}\nTask matches:\n${sizes.join('\n') || '(none)'}`.slice(0, 3200) };
}
