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
  // Minimal Range + Selection stubs — the helper only calls
  // ``selectNodeContents`` on the range and add/removeRanges
  // on the selection.
  const fakeSelection = {
    rangeCount: 0,
    getRangeAt: () => ({}),
    removeAllRanges: () => undefined,
    addRange: () => undefined,
  };
  vi.stubGlobal("document", {
    createElement: () => ({
      textContent: "",
      setAttribute: () => undefined,
      style: {},
    }),
    createRange: () => ({
      selectNodeContents: () => undefined,
      cloneRange: () => ({}),
    }),
    getSelection: () => fakeSelection,
    body: fakeBody,
    execCommand: execSpy,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  return { execSpy, appended, removed };
}

describe("copyToClipboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses execCommand first (synchronous, preserves user gesture)", async () => {
    // The order is load-bearing: ``execCommand`` runs
    // synchronously and the click handler's user-gesture
    // token is still valid; awaiting the async Clipboard API
    // first and falling back to execCommand on rejection
    // loses the gesture and ``execCommand`` then returns
    // ``true`` without actually copying. This test pins the
    // ordering so a refactor that "cleans up" by trying the
    // modern API first gets caught here.
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { execSpy } = stubDocument(true);
    const ok = await copyToClipboard("hello");
    expect(ok).toBe(true);
    expect(execSpy).toHaveBeenCalledWith("copy");
    // Modern API isn't called when execCommand succeeds.
    expect(writeText).not.toHaveBeenCalled();
  });

  it("falls back to navigator.clipboard.writeText when execCommand fails", async () => {
    // Some secure-context browsers gate ``execCommand`` even
    // though the function exists — the modern API is the
    // recovery path. (Reverse of the typical case.)
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    stubDocument(false);
    const ok = await copyToClipboard("hello");
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("returns true when execCommand succeeds without a clipboard API", async () => {
    // Plain-HTTP shape: ``navigator.clipboard`` is undefined,
    // legacy path is the only option.
    vi.stubGlobal("navigator", {});
    const { execSpy } = stubDocument(true);
    const ok = await copyToClipboard("fallback-text");
    expect(ok).toBe(true);
    expect(execSpy).toHaveBeenCalledWith("copy");
  });

  it("returns false when both paths fail", async () => {
    const writeText = vi.fn(async () => {
      throw new Error("NotAllowedError");
    });
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    stubDocument(false);
    const ok = await copyToClipboard("text");
    expect(ok).toBe(false);
    expect(writeText).toHaveBeenCalledWith("text");
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
