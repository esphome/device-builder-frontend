import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearStoredToken,
  getStoredToken,
  setStoredToken,
} from "../../src/util/auth-token.js";

describe("auth-token", () => {
  // Mirrors the just-created.test.ts pattern: vitest runs in node, so
  // localStorage has to be stubbed per-test.
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when nothing is stored", () => {
    expect(getStoredToken()).toBeNull();
  });

  it("round-trips a token through set/get", () => {
    setStoredToken("abc123", 1_700_000_000);
    expect(getStoredToken()).toBe("abc123");
  });

  it("clearStoredToken drops a previously-stored token", () => {
    setStoredToken("abc123", 1_700_000_000);
    clearStoredToken();
    expect(getStoredToken()).toBeNull();
  });

  it("ignores malformed JSON in storage", () => {
    // Simulate stale data from a prior version that wrote the bare
    // token instead of the {token, expires_at} envelope.
    localStorage.setItem("esphome.auth-token", "not json {");
    expect(getStoredToken()).toBeNull();
  });

  it("ignores values without a token field", () => {
    localStorage.setItem("esphome.auth-token", JSON.stringify({}));
    expect(getStoredToken()).toBeNull();
  });

  it("treats an empty token string as no token", () => {
    localStorage.setItem(
      "esphome.auth-token",
      JSON.stringify({ token: "", expires_at: 0 })
    );
    expect(getStoredToken()).toBeNull();
  });

  it("tolerates localStorage failures across all entry points", () => {
    // Private-mode browsers and sandboxed iframes can throw on every
    // localStorage access. The helpers swallow these — auth still
    // works (in-memory token on the API client carries the session).
    vi.stubGlobal("localStorage", {
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
    expect(() => setStoredToken("abc", 1)).not.toThrow();
    expect(getStoredToken()).toBeNull();
    expect(() => clearStoredToken()).not.toThrow();
  });
});
