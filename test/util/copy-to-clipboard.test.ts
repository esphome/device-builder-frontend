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
interface FakeElement {
  tag: string;
  textContent: string;
  setAttribute: (...args: unknown[]) => void;
  style: Record<string, string>;
}

function stubDocument(execReturn: boolean): {
  execSpy: ReturnType<typeof vi.fn>;
  appended: FakeElement[];
  removed: FakeElement[];
} {
  const appended: FakeElement[] = [];
  const removed: FakeElement[] = [];
  const execSpy = vi.fn(() => execReturn);
  const fakeBody = {
    appendChild: (el: FakeElement): FakeElement => {
      appended.push(el);
      return el;
    },
    removeChild: (el: FakeElement): FakeElement => {
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
    // Record the tag passed in so tests can pin "the helper
    // creates a span, not a textarea" rather than just
    // "the helper creates AN element". A refactor that
    // switches back to textarea (which the docstring warns
    // against — see the load-bearing reasons in
    // ``copy-to-clipboard.ts``) would silently regress
    // without this assertion.
    createElement: (tag: string): FakeElement => ({
      tag,
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

  it("appends a hidden <span> and removes it even on the failure path", async () => {
    // The legacy path injects a hidden ``<span>`` (NOT a
    // textarea — see the load-bearing reasons in the helper's
    // docstring) into the DOM. Pin both the element tag and
    // that it gets removed in success / failure cases — a
    // stale span would accumulate per click and eventually
    // become visible on a flaky scroll, AND a refactor that
    // switches back to textarea would silently regress the
    // ``<dialog>``-trapped-context bug we hit on
    // ``http://0.0.0.0:6052``.
    vi.stubGlobal("navigator", {});
    const { appended, removed } = stubDocument(false);
    await copyToClipboard("text");
    expect(appended.length).toBe(1);
    expect(appended[0].tag).toBe("span");
    expect(removed.length).toBe(1);
    expect(appended[0]).toBe(removed[0]);
  });
});
