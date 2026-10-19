import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { SecretStorage } from 'vscode';
import { initializeRouter, routeTask } from '../src/router';

const envKey = (name: string): string | undefined => process.env[name]?.trim() || undefined;

const secrets = {
  get: async (key: string): Promise<string | undefined> => {
    if (key === 'GEMINI_API_KEY' || key === 'BATON_PERSONAL_GEMINI_API_KEY') return envKey(key);
    if (key === 'OLLAMA_API_KEY') return envKey('OLLAMA_API_KEY');
    return undefined;
  },
  onDidChange: () => ({ dispose: () => undefined }),
};

const TASKS = [
  'Fix the typo in the README documentation',
  'Fix the flaky login test in CI',
  'Add a multi-file user profile feature with tests',
  'Delete production data',
  'Research which agent handles long-context tasks best',
];

async function main(): Promise<void> {
  const storageRoot = await mkdtemp(path.join(tmpdir(), 'baton-route-demo-'));
  try {
    initializeRouter(secrets as unknown as SecretStorage, {
      extensionUri: { fsPath: path.resolve(__dirname, '..') },
      globalStorageUri: { fsPath: storageRoot },
    });

    for (const [index, task] of TASKS.entries()) {
      const result = await routeTask(task, '');
      console.log(`\n#${index + 1} ${task}`);
      console.log(`tier: ${result.tier}`);
      console.log(JSON.stringify(result.route, null, 2));
      if (result.notice) console.log(`notice: ${result.notice}`);
    }
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
