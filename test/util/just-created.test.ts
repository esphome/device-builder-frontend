import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearJustCreated,
  consumeJustCreated,
  markJustCreated,
} from "../../src/util/just-created.js";

describe("just-created", () => {
  // The vitest config runs in the ``node`` environment which has no
  // ``sessionStorage``. Stub it with a tiny in-memory Map per-test so
  // we don't need to pull in jsdom for two methods. Same shape as
  // ``pending-highlight.test.ts``.
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

  it("returns false from consume when nothing is marked", () => {
    expect(consumeJustCreated("kitchen.yaml")).toBe(false);
  });

  it("returns true exactly once and clears the flag", () => {
    markJustCreated("kitchen.yaml");
    expect(consumeJustCreated("kitchen.yaml")).toBe(true);
    // Second consume on the same key — the welcome banner should
    // only fire once, so the flag has to be gone.
    expect(consumeJustCreated("kitchen.yaml")).toBe(false);
  });

  it("returns false when consume keys don't match the marked value", () => {
    // Pin the strict equality: a wizard for ``kitchen.yaml`` musn't
    // accidentally fire the banner for ``kitchen-2.yaml`` even
    // though the names share a prefix.
    markJustCreated("kitchen.yaml");
    expect(consumeJustCreated("kitchen-2.yaml")).toBe(false);
    // The original mark survives a non-matching consume — only the
    // exact-match consume clears it.
    expect(consumeJustCreated("kitchen.yaml")).toBe(true);
  });

  it("clearJustCreated drops a pending mark unconditionally", () => {
    // Used by the rename flow: the pre-rename flag points at the
    // old filename, which the device-page mount can no longer
    // match. Drop it rather than try to rewrite, since the user's
    // already engaged with the device.
    markJustCreated("kitchen.yaml");
    clearJustCreated();
    expect(consumeJustCreated("kitchen.yaml")).toBe(false);
  });

  it("clearJustCreated is a no-op when nothing is marked", () => {
    // Rename can fire on devices that were never just-created
    // (existing device renamed to something else); the clear has
    // to tolerate that without throwing.
    expect(() => clearJustCreated()).not.toThrow();
    expect(consumeJustCreated("anything.yaml")).toBe(false);
  });

  it("tolerates sessionStorage failures across all entry points", () => {
    // Private-mode browsers and sandboxed iframes can throw on
    // every ``sessionStorage`` access. The helpers swallow these
    // — the welcome banner is decoration, not worth blowing up
    // the wizard / rename / device-mount over.
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
      clear: () => {
        throw new Error("blocked");
      },
    });
    expect(() => markJustCreated("kitchen.yaml")).not.toThrow();
    expect(consumeJustCreated("kitchen.yaml")).toBe(false);
    expect(() => clearJustCreated()).not.toThrow();
  });
});
