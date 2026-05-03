import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumePendingHighlight,
  markPendingHighlight,
} from "../../src/util/pending-highlight.js";

describe("pending-highlight", () => {
  // The vitest config runs in the ``node`` environment which has no
  // ``sessionStorage``. The helper just calls ``getItem`` /
  // ``setItem`` / ``removeItem`` so a tiny in-memory Map stand-in is
  // enough — we don't need to pull in jsdom for two methods.
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when nothing is pending", () => {
    expect(consumePendingHighlight()).toBeNull();
  });

  it("round-trips a configuration string", () => {
    markPendingHighlight("kitchen.yaml");
    expect(consumePendingHighlight()).toBe("kitchen.yaml");
  });

  it("clears the flag after consumption (one-shot)", () => {
    markPendingHighlight("kitchen.yaml");
    consumePendingHighlight();
    // Second consume on an empty bucket — the highlight only fires
    // on the dashboard's next mount, not every mount thereafter.
    expect(consumePendingHighlight()).toBeNull();
  });

  it("overwrites prior pending values", () => {
    // If the user creates two devices in quick succession only the
    // most recent lights up; that's deliberate so they don't see a
    // stale flash from the previous import.
    markPendingHighlight("first.yaml");
    markPendingHighlight("second.yaml");
    expect(consumePendingHighlight()).toBe("second.yaml");
  });
});
