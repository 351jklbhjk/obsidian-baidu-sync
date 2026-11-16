export interface AutoSyncTiming {
  now: number;
  debounceMs: number;
  minIntervalMs: number;
  lastAutoSyncAt: number;
  backoffUntil: number;
}

/** Earliest time a new automatic sync may start, as a delay from now. */
export function nextAutoSyncDelay(timing: AutoSyncTiming): number {
  const debounce = Math.max(0, timing.debounceMs || 0);
  const minInterval = Math.max(0, timing.minIntervalMs || 0);
  const backoffUntil = Math.max(0, timing.backoffUntil || 0);
  const earliest = Math.max(
    timing.now + debounce,
    timing.lastAutoSyncAt + minInterval,
    backoffUntil
  );
  return Math.max(0, earliest - timing.now);
}

/** 60s, 120s, 240s, then 300s for repeated failures. */
export function autoSyncBackoffMs(failureCount: number): number {
  const count = Math.max(1, Math.min(4, Math.floor(failureCount || 1)));
  return Math.min(300000, 60000 * 2 ** (count - 1));
}
