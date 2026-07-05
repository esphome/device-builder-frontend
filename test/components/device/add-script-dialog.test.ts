/**
 * @vitest-environment happy-dom
 *
 * Regression coverage for the esphome-base-dialog migration (#549).
 *
 * The migration swapped the imperative ``dialog.open`` for a reactive
 * ``_open`` flag, so the open/close contract is the part most likely to
 * silently regress. esphome-base-dialog never mutates its own ``open`` on
 * a user close (Escape / X / outside-click), so the host must flip
 * the open flag itself in the controller's ``onRequestClose`` — otherwise a re-render would
 * re-assert ``?open`` and the dialog could never dismiss.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeAddScriptDialog } from "../../../src/components/device/add-script-dialog.js";
import { mount } from "../../_dom.js";

describe("add-script-dialog base-dialog open contract", () => {
  it("open() drives the reactive open flag", async () => {
    const el = await mount(new ESPHomeAddScriptDialog());
    const view = el as unknown as { _dialog: { open: boolean } };
    expect(view._dialog.open).toBe(false);
    el.open();
    expect(view._dialog.open).toBe(true);
  });

  it("the controller's onRequestClose flips the reactive open flag", async () => {
    const el = await mount(new ESPHomeAddScriptDialog());
    const view = el as unknown as {
      _dialog: { open: boolean; onRequestClose: () => void };
    };
    el.open();
    expect(view._dialog.open).toBe(true);
    view._dialog.onRequestClose();
    expect(view._dialog.open).toBe(false);
  });
});
