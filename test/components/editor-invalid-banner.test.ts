/**
 * @vitest-environment happy-dom
 *
 * Pins the invalid-banner's smart reveal: errors near the caret stay
 * squiggle-only while the user is typing, and the banner surfaces on
 * caret-move / blur / idle — never over a half-typed token.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ESPHomeEditorInvalidBanner } from "../../src/components/device/editor-invalid-banner.js";
import type { BannerError } from "../../src/util/yaml-lint-backend.js";

import "../../src/components/device/editor-invalid-banner.js";

const err = (line?: number): BannerError => ({
  message: `boom at ${line ?? "nowhere"}`,
  line,
  kind: "parse",
});

interface Harness {
  el: ESPHomeEditorInvalidBanner;
  bumpEdit: () => void;
}

async function mountBanner({
  focused = true,
  caret = 55,
}: { focused?: boolean; caret?: number } = {}): Promise<Harness> {
  const el = document.createElement("esphome-editor-invalid-banner");
  let lastEditAt = performance.now();
  el.getLastEditAt = () => lastEditAt;
  el.editorFocused = focused;
  el.caretLine = caret;
  document.body.appendChild(el);
  await el.updateComplete;
  return { el, bumpEdit: () => (lastEditAt = performance.now()) };
}

const banner = (el: ESPHomeEditorInvalidBanner) =>
  el.shadowRoot!.querySelector(".invalid-banner");

describe("editor-invalid-banner smart reveal", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "performance"],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("suppresses an error near the caret until the idle backstop", async () => {
    const { el } = await mountBanner({ caret: 55 });
    el.errors = [err(57)];
    await el.updateComplete;
    expect(banner(el)).toBeNull();

    vi.advanceTimersByTime(14_000);
    await el.updateComplete;
    expect(banner(el)).toBeNull();

    vi.advanceTimersByTime(1_200);
    await el.updateComplete;
    expect(banner(el)).not.toBeNull();
  });

  it("continued edits keep deferring the idle reveal", async () => {
    const { el, bumpEdit } = await mountBanner({ caret: 55 });
    el.errors = [err(57)];
    await el.updateComplete;

    vi.advanceTimersByTime(10_000);
    bumpEdit();
    vi.advanceTimersByTime(14_000); // 24s total, only 14s since last edit
    await el.updateComplete;
    expect(banner(el)).toBeNull();

    vi.advanceTimersByTime(1_200);
    await el.updateComplete;
    expect(banner(el)).not.toBeNull();
  });

  it("reveals when the caret moves away from the error", async () => {
    const { el } = await mountBanner({ caret: 55 });
    el.errors = [err(57)];
    await el.updateComplete;
    expect(banner(el)).toBeNull();

    el.caretLine = 70;
    await el.updateComplete;
    expect(banner(el)).not.toBeNull();
  });

  it("reveals when the editor loses focus", async () => {
    const { el } = await mountBanner({ caret: 55 });
    el.errors = [err(57)];
    await el.updateComplete;
    expect(banner(el)).toBeNull();

    el.editorFocused = false;
    await el.updateComplete;
    expect(banner(el)).not.toBeNull();
  });

  it("shows an error far from the caret immediately", async () => {
    const { el } = await mountBanner({ caret: 55 });
    el.errors = [err(10)];
    await el.updateComplete;
    expect(banner(el)).not.toBeNull();
  });

  it("shows a line-less validation error immediately even while typing", async () => {
    const { el } = await mountBanner({ caret: 55 });
    el.errors = [{ message: "Platform missing.", kind: "validation" }];
    await el.updateComplete;
    expect(banner(el)).not.toBeNull();
  });

  it("damps a validation error anchored near the caret like a parse error", async () => {
    const { el } = await mountBanner({ caret: 15 });
    el.errors = [{ message: "expected a dictionary.", line: 15, kind: "validation" }];
    await el.updateComplete;
    expect(banner(el)).toBeNull();

    vi.advanceTimersByTime(15_200);
    await el.updateComplete;
    expect(banner(el)).not.toBeNull();
  });

  it("shows a validation error anchored far from the caret immediately", async () => {
    const { el } = await mountBanner({ caret: 55 });
    el.errors = [{ message: "expected a dictionary.", line: 15, kind: "validation" }];
    await el.updateComplete;
    expect(banner(el)).not.toBeNull();
  });

  it("holds every reveal while the completion popup is open", async () => {
    const { el } = await mountBanner({ caret: 55 });
    el.completionOpen = true;
    el.errors = [{ message: "Platform missing.", kind: "validation" }];
    await el.updateComplete;
    expect(banner(el)).toBeNull();
    // The hold is timerless — closing the popup is the only wake signal.
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(20_000); // even the idle backstop waits
    await el.updateComplete;
    expect(banner(el)).toBeNull();

    el.completionOpen = false;
    await el.updateComplete;
    expect(banner(el)).not.toBeNull();
  });

  it("shows a pre-existing error promptly when the user never typed", async () => {
    const el = document.createElement("esphome-editor-invalid-banner");
    el.editorFocused = true;
    el.caretLine = 57; // near the error, but the idle clock reads never-typed
    document.body.appendChild(el);
    await el.updateComplete;
    el.errors = [err(57)];
    await el.updateComplete;
    expect(banner(el)).not.toBeNull();
  });

  it("treats a line-less error as suppressible", async () => {
    const { el } = await mountBanner({ caret: 55 });
    el.errors = [err(undefined)];
    await el.updateComplete;
    expect(banner(el)).toBeNull();

    el.editorFocused = false;
    await el.updateComplete;
    expect(banner(el)).not.toBeNull();
  });

  it("clears immediately and cancels a pending reveal", async () => {
    const { el } = await mountBanner({ caret: 55 });
    el.errors = [err(57)];
    await el.updateComplete;
    el.errors = [];
    await el.updateComplete;
    expect(banner(el)).toBeNull();

    vi.advanceTimersByTime(30_000);
    await el.updateComplete;
    expect(banner(el)).toBeNull();
  });

  it("clears a visible banner immediately", async () => {
    const { el } = await mountBanner({ focused: false });
    el.errors = [err(57)];
    await el.updateComplete;
    expect(banner(el)).not.toBeNull();

    el.errors = [];
    await el.updateComplete;
    expect(banner(el)).toBeNull();
  });

  it("updates a visible banner in place without waiting", async () => {
    const { el } = await mountBanner({ focused: false });
    el.errors = [err(57)];
    await el.updateComplete;
    expect(banner(el)).not.toBeNull();

    el.editorFocused = true;
    el.errors = [err(60), err(61)];
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll(".danger-banner-text > span")).toHaveLength(2);
  });

  it("caps the list at six errors and collapses the rest", async () => {
    const { el } = await mountBanner({ focused: false });
    el.errors = Array.from({ length: 7 }, (_, i) => err(i + 1));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll(".danger-banner-text > span")).toHaveLength(
      7 // 6 errors + the "+N more" span
    );
    expect(el.shadowRoot!.querySelector(".invalid-banner-more")).not.toBeNull();
  });
});

describe("editor-invalid-banner events", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "performance"],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dispatches banner-goto-line and banner-auto-fix from the buttons", async () => {
    const { el } = await mountBanner({ focused: false });
    const fix = { line: 57, indent: 2, key: "platform" };
    el.errors = [{ message: "boom", line: 57, fix, kind: "parse" }];
    await el.updateComplete;

    const gotoLines: number[] = [];
    const fixes: unknown[] = [];
    el.addEventListener("banner-goto-line", (e) =>
      gotoLines.push((e as CustomEvent).detail.line)
    );
    el.addEventListener("banner-auto-fix", (e) =>
      fixes.push((e as CustomEvent).detail.fix)
    );

    const buttons =
      el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".invalid-banner-goto");
    expect(buttons).toHaveLength(2); // auto-fix first, then go-to-line
    buttons[0].click();
    buttons[1].click();

    expect(fixes).toEqual([fix]);
    expect(gotoLines).toEqual([57]);
  });
});
