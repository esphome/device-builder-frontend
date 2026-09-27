import { vi } from "vitest";

import type {
  ReceiverNote,
  ReceiverRunHooks,
} from "../../src/web/flash-receiver/receiver-engine.js";

/** Hooks that keep what an engine reported, as ``state:message`` and notes. */
export function recordingHooks(): ReceiverRunHooks & {
  states: string[];
  waits: string[];
} {
  const rec = {
    states: [] as string[],
    waits: [] as string[],
    onState: (state: string, message: string) => rec.states.push(`${state}:${message}`),
    onProgress: vi.fn(),
    onLog: vi.fn(),
    onWaiting: (note: ReceiverNote) => rec.waits.push(note.message),
  };
  return rec;
}

export const last = <T>(items: T[]): T => items[items.length - 1];
