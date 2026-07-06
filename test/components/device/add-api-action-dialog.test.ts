/**
 * @vitest-environment happy-dom
 *
 * Open/close contract for the add-api-action dialog after its
 * migration onto ``esphome-base-dialog``. The wrapper never mutates
 * its own ``open`` on a user-driven close (Escape / X / backdrop), so
 * the host owns the reactive ``_open`` flag: ``open()`` must set it and
 * the ``@request-close`` handler must clear it. Guards against a
 * re-render re-asserting ``?open`` and trapping the dialog open.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/components/base-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));

import { ESPHomeAddApiActionDialog } from "../../../src/components/device/add-api-action-dialog.js";
import { identityLocalize } from "../../_dom.js";

async function mountDialog(): Promise<ESPHomeAddApiActionDialog> {
  const dialog = new ESPHomeAddApiActionDialog();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dialog as any)._localize = identityLocalize; // no context provider in the test tree
  document.body.appendChild(dialog);
  await dialog.updateComplete;
  return dialog;
}

const isOpen = (d: ESPHomeAddApiActionDialog): boolean =>
  (d as unknown as { _dialog: { open: boolean } })._dialog.open;

const requestClose = (d: ESPHomeAddApiActionDialog): void =>
  (d as unknown as { _dialog: { onRequestClose: () => void } })._dialog.onRequestClose();

describe("esphome-add-api-action-dialog base-dialog open contract", () => {
  it("open() drives the reactive _open flag", async () => {
    const dialog = await mountDialog();
    expect(isOpen(dialog)).toBe(false);
    dialog.open();
    expect(isOpen(dialog)).toBe(true);
  });

  it("the controller's onRequestClose flips the open flag back to false", async () => {
    const dialog = await mountDialog();
    dialog.open();
    expect(isOpen(dialog)).toBe(true);
    requestClose(dialog);
    expect(isOpen(dialog)).toBe(false);
  });

  it("open() resets the name and error fields", async () => {
    const dialog = await mountDialog();
    (dialog as unknown as { _name: string })._name = "stale";
    (dialog as unknown as { _error: string })._error = "boom";
    dialog.open();
    expect((dialog as unknown as { _name: string })._name).toBe("");
    expect((dialog as unknown as { _error: string })._error).toBe("");
  });
});
