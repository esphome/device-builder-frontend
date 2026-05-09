import { afterEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "../../src/util/copy-to-clipboard.js";

/**
 * Inline document stub — vitest's default ``node`` environment
 * doesn't ship a DOM. Mirrors the existing pattern in
 * ``test/util/navigation.test.ts`` (stub on ``globalThis`` rather
 * than pulling in jsdom / happy-dom). Captures appended elements
 * so tests can assert on DOM lifecycle without needing a real
 * document body.
 */
function stubDocument(execReturn: boolean): {
  execSpy: ReturnType<typeof vi.fn>;
  appended: object[];
  removed: object[];
} {
  const appended: object[] = [];
  const removed: object[] = [];
  const execSpy = vi.fn(() => execReturn);
  const fakeBody = {
    appendChild: <T extends object>(el: T): T => {
      appended.push(el);
      return el;
    },
    removeChild: <T extends object>(el: T): T => {
      removed.push(el);
      return el;
    },
  };
  vi.stubGlobal("document", {
    createElement: () => ({
      value: "",
      setAttribute: () => undefined,
      style: {},
      focus: () => undefined,
      select: () => undefined,
      setSelectionRange: () => undefined,
    }),
    body: fakeBody,
    activeElement: null,
    execCommand: execSpy,
  });
  return { execSpy, appended, removed };
}

describe("copyToClipboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses navigator.clipboard.writeText when available", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const ok = await copyToClipboard("hello");
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to execCommand when clipboard is undefined", async () => {
    // Non-secure-context shape: HA-addon direct port,
    // container deploys on plain HTTP at non-localhost LAN
    // IPs. The helper should reach for the legacy textarea
    // path instead of returning false.
    vi.stubGlobal("navigator", {});
    const { execSpy } = stubDocument(true);
    const ok = await copyToClipboard("fallback-text");
    expect(ok).toBe(true);
    expect(execSpy).toHaveBeenCalledWith("copy");
  });

  it("falls back to execCommand when writeText rejects", async () => {
    // Modern API present but throwing — the
    // ``NotAllowedError`` path that fires on plain-HTTP
    // contexts where ``navigator.clipboard`` exists but is
    // gated. Helper should swallow and try the legacy path
    // rather than bubbling the error to the caller.
    const writeText = vi.fn(async () => {
      throw new Error("NotAllowedError");
    });
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { execSpy } = stubDocument(true);
    const ok = await copyToClipboard("text");
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("text");
    expect(execSpy).toHaveBeenCalledWith("copy");
  });

  it("returns false when both paths fail", async () => {
    vi.stubGlobal("navigator", {});
    stubDocument(false);
    const ok = await copyToClipboard("text");
    expect(ok).toBe(false);
  });

  it("removes the textarea even on the failure path", async () => {
    // The legacy path injects a hidden ``<textarea>`` into the
    // DOM. Pin that it gets removed in both success and
    // failure cases — a stale textarea would accumulate per
    // click and eventually become visible on a flaky scroll.
    vi.stubGlobal("navigator", {});
    const { appended, removed } = stubDocument(false);
    await copyToClipboard("text");
    expect(appended.length).toBe(1);
    expect(removed.length).toBe(1);
    expect(appended[0]).toBe(removed[0]);
  });
});
