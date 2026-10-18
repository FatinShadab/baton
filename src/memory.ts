export type MemoryHit = { source: string; text: string };

/** Placeholder until local memory search is implemented. */
export async function searchMemory(_task: string, _limit = 5): Promise<MemoryHit[]> {
  return [];
}
