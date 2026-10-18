export const ROUTER_TIMEOUT_MS = 8_000;

/** Bound the whole tier, including key lookup, response reading, and compatibility retries. */
export async function withinDeadline<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(undefined);
      }, ROUTER_TIMEOUT_MS);
    });
    return await Promise.race([work(controller.signal), deadline]);
  } catch {
    // Provider, transport, and parsing failures all advance to the next tier.
    return undefined;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
