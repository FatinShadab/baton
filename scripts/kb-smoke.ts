import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { loadAvailability, loadKB, loadSources } from '../src/kb/store';

async function main(): Promise<void> {
  const storageRoot = await mkdtemp(path.join(tmpdir(), 'baton-kb-smoke-'));
  const context = {
    extensionUri: { fsPath: path.resolve(__dirname, '..') },
    globalStorageUri: { fsPath: storageRoot },
  };
  try {
    const kb = await loadKB(context);
    await loadAvailability(context);
    await loadSources(context);
    console.log(`agents: ${kb.agents.map((agent) => agent.id).join(', ')}`);
    console.log(`models: ${kb.models.length}`);
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
