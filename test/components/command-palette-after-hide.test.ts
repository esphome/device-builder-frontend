// @vitest-environment happy-dom
import { describe, expect, test, vi } from "vitest";

// Stub the real wa-dialog: happy-dom can't run its form-associated
// internals, and these tests only cover the palette's own flag sync.
vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));

import { ESPHomeCommandPalette } from "../../src/components/command-palette.js";

/**
 * Pins the palette's wa-dialog close contract: ``_onAfterHide`` syncs
 * ``_open`` and drops the content only for the palette's own wa-dialog
 * (not a bubbled descendant), and ``close()`` keeps the content
 * rendered so the hide animation doesn't run on an empty card.
 */

interface PaletteView extends EventTarget {
  _open: boolean;
  _contentRendered: boolean;
  _yamlSearch: { clear: () => void };
  _onAfterHide(e: Event): void;
  open(): void;
  close(): void;
}

function makePalette(): PaletteView {
  return new ESPHomeCommandPalette() as unknown as PaletteView;
}

function afterHideEvent(sameTarget: boolean): Event {
  const event = new Event("wa-after-hide", { bubbles: true });
  const own = document.createElement("wa-dialog");
  const target = sameTarget ? own : document.createElement("wa-dialog");
  Object.defineProperty(event, "currentTarget", { value: own });
  Object.defineProperty(event, "target", { value: target });
  return event;
}

describe("esphome-command-palette wa-after-hide contract", () => {
  test("own wa-after-hide closes, drops content, clears yaml search", () => {
    const palette = makePalette();
    palette.open();
    expect(palette._open).toBe(true);
    expect(palette._contentRendered).toBe(true);
    const clear = vi.spyOn(palette._yamlSearch, "clear");

    palette._onAfterHide(afterHideEvent(true));

    expect(palette._open).toBe(false);
    expect(palette._contentRendered).toBe(false);
    expect(clear).toHaveBeenCalled();
  });

  test("bubbled wa-after-hide from a descendant is ignored", () => {
    const palette = makePalette();
    palette.open();

    palette._onAfterHide(afterHideEvent(false));

    expect(palette._open).toBe(true);
    expect(palette._contentRendered).toBe(true);
  });

  test("close() flips _open but keeps content for the hide animation", () => {
    const palette = makePalette();
    palette.open();

    palette.close();

    expect(palette._open).toBe(false);
    expect(palette._contentRendered).toBe(true);
  });
});
