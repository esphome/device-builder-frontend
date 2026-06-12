// @vitest-environment happy-dom
import { describe, expect, test, vi } from "vitest";

// Stub the real wa-dialog: happy-dom can't run its form-associated
// internals, and these tests only cover the palette's own flag sync.
vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));

import { ESPHomeCommandPalette } from "../../src/components/command-palette.js";

/**
 * Pins the palette's wa-dialog close contract: ``_onHide`` syncs
 * ``_open`` / clears the YAML search on the initiating hide (so a
 * queued ``yaml/search`` can't flush during the hide animation),
 * ``_onAfterHide`` drops the content only once hidden and only when
 * not reopened mid-animation, and both ignore bubbled events from
 * descendants.
 */

interface PaletteView extends EventTarget {
  _open: boolean;
  _contentRendered: boolean;
  _yamlSearch: { clear: () => void };
  _onHide(e: Event): void;
  _onAfterHide(e: Event): void;
  open(): void;
  close(): void;
}

function makePalette(): PaletteView {
  return new ESPHomeCommandPalette() as unknown as PaletteView;
}

function hideEvent(type: string, sameTarget: boolean): Event {
  const event = new Event(type, { bubbles: true });
  const own = document.createElement("wa-dialog");
  const target = sameTarget ? own : document.createElement("wa-dialog");
  Object.defineProperty(event, "currentTarget", { value: own });
  Object.defineProperty(event, "target", { value: target });
  return event;
}

describe("esphome-command-palette wa-dialog close contract", () => {
  test("own wa-hide closes immediately and clears yaml search", () => {
    const palette = makePalette();
    palette.open();
    expect(palette._open).toBe(true);
    expect(palette._contentRendered).toBe(true);
    const clear = vi.spyOn(palette._yamlSearch, "clear");

    palette._onHide(hideEvent("wa-hide", true));

    expect(palette._open).toBe(false);
    expect(clear).toHaveBeenCalled();
    // Content survives until the hide animation finishes.
    expect(palette._contentRendered).toBe(true);
  });

  test("own wa-after-hide drops the content once hidden", () => {
    const palette = makePalette();
    palette.open();
    palette._onHide(hideEvent("wa-hide", true));

    palette._onAfterHide(hideEvent("wa-after-hide", true));

    expect(palette._contentRendered).toBe(false);
  });

  test("wa-after-hide keeps the content when reopened mid-animation", () => {
    const palette = makePalette();
    palette.open();
    palette._onHide(hideEvent("wa-hide", true));
    palette.open();

    palette._onAfterHide(hideEvent("wa-after-hide", true));

    expect(palette._open).toBe(true);
    expect(palette._contentRendered).toBe(true);
  });

  test("bubbled events from a descendant are ignored", () => {
    const palette = makePalette();
    palette.open();

    palette._onHide(hideEvent("wa-hide", false));
    palette._onAfterHide(hideEvent("wa-after-hide", false));

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
