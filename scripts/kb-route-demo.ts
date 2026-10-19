import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { SecretStorage } from 'vscode';
import { initializeRouter, routeTask } from '../src/router';

const secrets = {
  get: async (): Promise<string | undefined> => undefined,
  onDidChange: () => ({ dispose: () => undefined }),
};

const TASKS = [
  'Fix the typo in the README documentation',
  'Fix the flaky login test in CI',
  'Add a multi-file user profile feature with tests',
  'Write tests for the login form',
  'Delete production data',
  'Research which agent handles long-context tasks best',
];
const EXPECTED_TYPES = new Map([
  ['Fix the flaky login test in CI', 'debugging'],
  ['Add a multi-file user profile feature with tests', 'implementation'],
  ['Write tests for the login form', 'testing'],
]);

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
      const expected = EXPECTED_TYPES.get(task);
      if (expected) {
        const pass = result.tier === 'rules' && result.route.task_type === expected;
        console.log(`${pass ? 'PASS' : 'FAIL'} rules classification: expected ${expected}, got ${result.route.task_type} (tier ${result.tier})`);
        if (!pass) process.exitCode = 1;
      }
    }
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
