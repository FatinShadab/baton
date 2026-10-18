export const ROUTER_TIMEOUT_MS = 30_000;

export class RouterTimeoutError extends Error {
  constructor() { super('Provider timed out.'); }
}

export class RouterHttpError extends Error {
  constructor(readonly status: number) { super(`Provider returned HTTP ${status}.`); }
}

export class RouterMissingKeyError extends Error {
  constructor() { super('API key is missing.'); }
}

/** Bound the whole tier, including key lookup, response reading, and compatibility retries. */
export async function withinDeadline<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs = ROUTER_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new RouterTimeoutError());
      }, timeoutMs);
    });
    return await Promise.race([work(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
