import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fetchSource } from '../src/kb/fetch';
import { loadSources } from '../src/kb/store';

const SIGNAL_WORDS = ['model', 'context window', 'reasoning', 'effort', 'tokens', 'supports', 'limit'];
const SIGNAL_THRESHOLD = 10;

const pad = (value: string | number, width: number): string => String(value).padEnd(width);

/** Case-insensitive occurrence count for each KB signal word/phrase. */
function signalCount(text: string): number {
  return SIGNAL_WORDS.reduce((total, word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = text.match(new RegExp(escaped, 'gi'));
    return total + (matches?.length ?? 0);
  }, 0);
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 200);

async function main(): Promise<void> {
  const extensionRoot = path.resolve(__dirname, '..');
  const storageRoot = await mkdtemp(path.join(tmpdir(), 'baton-kb-fetch-'));
  try {
    const sources = await loadSources({
      extensionUri: { fsPath: extensionRoot },
      globalStorageUri: { fsPath: storageRoot },
    });
    console.log(`sources: ${sources.sources.length}; cache dir: ${storageRoot}`);
    console.log(`${pad('agent', 12)}${pad('url', 98)}${pad('ok', 5)}${pad('status', 8)}${pad('chars', 8)}${pad('ms', 8)}${pad('cached', 8)}${pad('signal', 8)}error`);
    console.log('-'.repeat(165));

    const rows: Array<{ url: string; ok: boolean; text: string; signal: number }> = [];
    for (const entry of sources.sources) {
      const started = Date.now();
      const result = await fetchSource(
        entry.url,
        { globalStorageUri: { fsPath: storageRoot }, sources },
        { force: true },
      );
      const elapsed = Date.now() - started;
      const signal = signalCount(result.text);
      rows.push({ url: entry.url, ok: result.ok, text: result.text, signal });
      console.log(`${pad(entry.agent_id, 12)}${pad(entry.url, 98)}${pad(result.ok ? 'yes' : 'no', 5)}${pad(result.status, 8)}${pad(result.text.length, 8)}${pad(elapsed, 8)}${pad(result.from_cache ? 'yes' : 'no', 8)}${pad(signal, 8)}${result.error ?? ''}`);
    }

    console.log('\npreviews (first 200 chars of each OK source, whitespace collapsed)');
    for (const row of rows.filter((entry) => entry.ok)) {
      console.log(`\n${row.url}`);
      console.log(oneLine(row.text));
    }

    const ok = rows.filter((row) => row.ok).length;
    const signal = rows.filter((row) => row.signal >= SIGNAL_THRESHOLD).length;
    console.log('\nsummary');
    console.log(`sources ok: ${ok}/${rows.length}`);
    console.log(`sources with signal >= ${SIGNAL_THRESHOLD}: ${signal}`);
    console.log(`sources failed: ${rows.length - ok}`);
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
