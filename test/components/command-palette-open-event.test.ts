// @vitest-environment happy-dom
import { describe, expect, test, vi } from "vitest";

// Stub the real wa-dialog: happy-dom can't run its form-associated internals.
vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));

import { OPEN_COMMAND_PALETTE_EVENT } from "../../src/components/command-palette-actions.js";
import { ESPHomeCommandPalette } from "../../src/components/command-palette.js";

/** A connected palette opens on the window event the kebab Search item fires. */
describe("esphome-command-palette open-on-event", () => {
  test("the open-palette event opens the palette", async () => {
    const palette = new ESPHomeCommandPalette();
    document.body.appendChild(palette);
    await palette.updateComplete;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((palette as any)._open).toBe(false);

    window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((palette as any)._open).toBe(true);
  });

  test("the listener is removed on disconnect", async () => {
    const palette = new ESPHomeCommandPalette();
    document.body.appendChild(palette);
    await palette.updateComplete;
    palette.remove();

    window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((palette as any)._open).toBe(false);
  });
});
