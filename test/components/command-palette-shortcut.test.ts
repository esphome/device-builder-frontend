// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";

// Stub the real wa-dialog: happy-dom can't run its form-associated internals.
vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));

import { ESPHomeCommandPalette } from "../../src/components/command-palette.js";

/** The Cmd/Ctrl+K open shortcut, and that Shift is excluded (#1705). */
describe("esphome-command-palette open shortcut", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  async function mount(): Promise<ESPHomeCommandPalette> {
    const palette = new ESPHomeCommandPalette();
    document.body.appendChild(palette);
    await palette.updateComplete;
    return palette;
  }

  const isOpen = (palette: ESPHomeCommandPalette): boolean =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (palette as any)._open;

  test("Ctrl+K opens the palette", async () => {
    const palette = await mount();
    expect(isOpen(palette)).toBe(false);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));

    expect(isOpen(palette)).toBe(true);
  });

  test("Cmd+K opens the palette", async () => {
    const palette = await mount();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));

    expect(isOpen(palette)).toBe(true);
  });

  test("Ctrl+Shift+K does not open the palette (stays editor deleteLine)", async () => {
    const palette = await mount();

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", ctrlKey: true, shiftKey: true })
    );

    expect(isOpen(palette)).toBe(false);
  });

  test("Cmd+Shift+K does not open the palette", async () => {
    const palette = await mount();

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true, shiftKey: true })
    );

    expect(isOpen(palette)).toBe(false);
  });

  test("Cmd+K already handled by a focused editor does not open the palette", async () => {
    const palette = await mount();
    // A deeper handler (e.g. CodeMirror) consumed the keystroke first.
    window.addEventListener("keydown", (e) => e.preventDefault(), {
      capture: true,
      once: true,
    });

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", ctrlKey: true, cancelable: true })
    );

    expect(isOpen(palette)).toBe(false);
  });
});
