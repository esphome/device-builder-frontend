/**
 * @vitest-environment happy-dom
 *
 * Regression coverage for the esphome-base-dialog migration (#549).
 *
 * The migration swapped the imperative ``dialog.open`` for a reactive
 * ``_open`` flag, so the open/close contract is the part most likely to
 * silently regress. esphome-base-dialog never mutates its own ``open`` on
 * a user close (Escape / X / outside-click), so the host must flip
 * ``_open`` itself in ``_onRequestClose`` — otherwise a re-render would
 * re-assert ``?open`` and the dialog could never dismiss.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeAddScriptDialog } from "../../../src/components/device/add-script-dialog.js";
import { mount } from "../../_dom.js";

describe("add-script-dialog base-dialog open contract", () => {
  it("open() drives the reactive _open flag", async () => {
    const el = await mount(new ESPHomeAddScriptDialog());
    const view = el as unknown as { _open: boolean };
    expect(view._open).toBe(false);
    el.open();
    expect(view._open).toBe(true);
  });

  it("_onRequestClose flips the reactive open flag", async () => {
    const el = await mount(new ESPHomeAddScriptDialog());
    const view = el as unknown as { _open: boolean; _onRequestClose: () => void };
    el.open();
    expect(view._open).toBe(true);
    view._onRequestClose();
    expect(view._open).toBe(false);
  });
});
