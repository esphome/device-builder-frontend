import { vi } from "vitest";

// Captured before any fake timers replace it: the driver needs a real turn.
const realSetTimeout = globalThis.setTimeout;

/**
 * Drive a promise to completion under fake timers: rerun every timer, then
 * yield a real event-loop turn (WebCrypto and stream plumbing settle on
 * one), until it settles.
 */
export async function driveFakeTimers<T>(p: Promise<T>): Promise<T> {
  let settled = false;
  p.then(
    () => (settled = true),
    () => (settled = true)
  );
  while (!settled) {
    await vi.runAllTimersAsync();
    await new Promise((r) => realSetTimeout(r, 0));
  }
  return p;
}
