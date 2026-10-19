import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { SecretStorage } from 'vscode';
import { initializeRouter } from '../src/router';
import { loadSources } from '../src/kb/store';
import { updateKnowledge } from '../src/kb/update';

const envKey = (name: string): string | undefined => process.env[name]?.trim() || undefined;

/** Minimal SecretStorage shim so the router's key lookups work outside VS Code. */
const secrets = {
  get: async (key: string): Promise<string | undefined> => {
    if (key === 'GEMINI_API_KEY' || key === 'BATON_PERSONAL_GEMINI_API_KEY') return envKey(key);
    if (key === 'OLLAMA_API_KEY') return envKey('OLLAMA_API_KEY');
    return undefined;
  },
  onDidChange: () => ({ dispose: () => undefined }),
};

async function main(): Promise<void> {
  initializeRouter(secrets as unknown as SecretStorage);

  const extensionRoot = path.resolve(__dirname, '..');
  const storageRoot = await mkdtemp(path.join(tmpdir(), 'baton-kb-update-'));
  const gemini = Boolean(envKey('GEMINI_API_KEY') || envKey('BATON_PERSONAL_GEMINI_API_KEY'));
  const ollama = Boolean(envKey('OLLAMA_API_KEY'));

  try {
    const sources = await loadSources({
      extensionUri: { fsPath: extensionRoot },
      globalStorageUri: { fsPath: storageRoot },
    });
    console.log(`sources: ${sources.sources.length}; gemini key: ${gemini ? 'yes' : 'no'}; ollama key: ${ollama ? 'yes' : 'no'}`);
    if (!gemini && !ollama) {
      console.log('No provider key in this process. Extraction will fail; set GEMINI_API_KEY (or OLLAMA_API_KEY) and rerun.');
    }

    const result = await updateKnowledge({ force: true }, {
      extensionUri: { fsPath: extensionRoot },
      globalStorageUri: { fsPath: storageRoot },
      sources,
    });

    console.log(`pages=${result.pages} accepted=${result.accepted} rejected=${result.rejected} added=${result.added} changed=${result.changed} applied=${result.applied} staged=${Boolean(result.staged)}`);

    console.log('\nfailed sources');
    if (!result.failedSources.length) console.log('(none)');
    for (const failure of result.failedSources) {
      console.log(`${failure.agent_id} ${failure.url} — ${failure.error}`);
    }

    console.log('\nextraction errors');
    if (!result.extractionErrors.length) console.log('(none)');
    for (const failure of result.extractionErrors.slice(0, 12)) {
      console.log(`${failure.agent_id} ${failure.url} — ${failure.error}`);
    }

    console.log('\naccepted facts (first 5)');
    if (!result.acceptedExamples.length) console.log('(none)');
    for (const [index, fact] of result.acceptedExamples.slice(0, 5).entries()) {
      console.log(`${index + 1}. ${fact}`);
    }

    console.log('\nrejected facts (first 5)');
    if (!result.rejectedDetails.length) console.log('(none)');
    for (const [index, fact] of result.rejectedDetails.slice(0, 5).entries()) {
      console.log(`${index + 1}. ${fact.text} — ${fact.reason}`);
    }

    console.log('\nsummary');
    console.log(result.summary);
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
