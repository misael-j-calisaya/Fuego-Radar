/** SES retry schedule: 3 retries with exponential backoff (1s → 2s → 4s). */
export const SES_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn`, retrying after each delay in `delaysMs` when it throws.
 * Total attempts = delaysMs.length + 1. Rethrows the last error.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  delaysMs: readonly number[] = SES_RETRY_DELAYS_MS,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < delaysMs.length) await wait(delaysMs[attempt]);
    }
  }
  throw lastError;
}
