import MiniSearch from 'minisearch';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { JsonStore } from './store';

const ItemSchema = z.object({
  text: z.string().trim().min(1),
  kind: z.enum(['plan', 'decision', 'finding', 'task']),
  meta: z.record(z.unknown()).optional(),
});
const RecordSchema = ItemSchema.extend({ id: z.string(), createdAt: z.string().datetime() });
const RecordsSchema = z.array(RecordSchema);
export type MemoryItem = z.infer<typeof ItemSchema>;
type MemoryRecord = z.infer<typeof RecordSchema>;
export type MemoryHit = MemoryRecord & { source: string; score: number };

export interface MemoryStore {
  add(item: MemoryItem): Promise<boolean>;
  search(query: string, k?: number): Promise<MemoryHit[]>;
}

const stopWords = new Set(['a', 'an', 'and', 'are', 'for', 'in', 'is', 'of', 'on', 'the', 'to', 'with']);

/** Owns one index and serializes additions so disk and search stay consistent. */
export class LocalMemoryStore implements MemoryStore {
  private records: MemoryRecord[] = [];
  private index = this.newIndex();
  private loaded = false;
  private pending: Promise<unknown>;

  constructor(private readonly store: JsonStore) {
    this.pending = this.load().catch(() => { /* Preserve unreadable memory instead of overwriting it. */ });
  }

  private newIndex(): MiniSearch<MemoryRecord> {
    return new MiniSearch<MemoryRecord>({
      fields: ['text'],
      processTerm: (term) => stopWords.has(term.toLowerCase()) ? null : term.toLowerCase(),
      searchOptions: { prefix: true, fuzzy: 0.2 },
    });
  }

  private async load(): Promise<void> {
    const records = await this.store.read('memory.json', RecordsSchema, []);
    if (!records) return;
    this.index.addAll(records);
    this.records = records;
    this.loaded = true;
  }

  add(item: MemoryItem): Promise<boolean> {
    const operation = this.pending.then(async () => {
      if (!this.loaded) return false;
      const parsed = ItemSchema.parse(item);
      // Re-importing a task's plan replaces its previous searchable version.
      const taskId = parsed.meta?.taskId;
      const previous = typeof taskId === 'string'
        ? this.records.find((record) => record.kind === parsed.kind && record.meta?.taskId === taskId) : undefined;
      const record = RecordSchema.parse({ ...parsed, id: previous?.id ?? randomUUID(), createdAt: new Date().toISOString() });
      const records = [...this.records.filter((entry) => entry.id !== record.id), record];
      const index = this.newIndex();
      index.addAll(records);
      if (!await this.store.write('memory.json', RecordsSchema, records)) return false;
      this.records = records;
      this.index = index;
      return true;
    }).catch(() => false);
    this.pending = operation;
    return operation;
  }

  async search(query: string, k = 5): Promise<MemoryHit[]> {
    await this.pending;
    if (!this.loaded || !query.trim() || !Number.isFinite(k) || k <= 0) return [];
    try {
      const byId = new Map(this.records.map((record) => [record.id, record]));
      return this.index.search(query).slice(0, Math.floor(k)).flatMap((result) => {
        const record = byId.get(String(result.id));
        return record ? [{ ...record, meta: record.meta ? { ...record.meta } : undefined,
          score: result.score, source: `Memory ${record.kind} · ${record.id}` }] : [];
      });
    } catch {
      return [];
    }
  }
}

let activeStore: MemoryStore | undefined;
export function initializeMemory(store: JsonStore): MemoryStore {
  activeStore = new LocalMemoryStore(store);
  return activeStore;
}

export async function search(query: string, k = 5): Promise<MemoryHit[]> {
  return activeStore ? activeStore.search(query, k) : [];
}
