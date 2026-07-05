/**
 * @vitest-environment happy-dom
 *
 * The update trigger is fire-and-forget, but `desktop/update` can still report
 * `{ started: false }`; the dialog must not leave the user on the busy
 * "Updating" screen (the base-dialog busy gate blocks every dismiss path) when
 * the updater never spawned.
 *
 * These exercise the dialog's state logic directly; the element is intentionally
 * not connected to the DOM, so `wa-dialog` never renders (happy-dom can't drive
 * its form-validation internals).
 */
import { describe, expect, it, vi } from "vitest";

import type { DesktopUpdateCheck } from "../../src/api/types/desktop.js";
import { ESPHomeDesktopUpdateDialog } from "../../src/components/desktop-update-dialog.js";

function makeCheck(anyAvailable: boolean): DesktopUpdateCheck {
  const upToDate = {
    available: false,
    installed: "1.0.0",
    latest: "1.0.0",
    error: null,
  };
  return {
    any_available: anyAvailable,
    app: anyAvailable
      ? { available: true, installed: "0.14.0", latest: "0.15.0", error: null }
      : upToDate,
    esphome: upToDate,
    device_builder: { available: false, installed: null, latest: null, error: null },
  };
}

function make(api: unknown): ESPHomeDesktopUpdateDialog {
  const el = new ESPHomeDesktopUpdateDialog();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._api = api;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._localize = (key: string) => key;
  return el;
}

describe("desktop-update-dialog", () => {
  it("loads availability from check_update on open", async () => {
    const api = { desktopCheckUpdate: vi.fn().mockResolvedValue(makeCheck(true)) };
    const el = make(api);
    await el.open();
    expect(api.desktopCheckUpdate).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._check.any_available).toBe(true);
  });

  it("does not strand the user when the update fails to start", async () => {
    const api = {
      desktopCheckUpdate: vi.fn().mockResolvedValue(makeCheck(true)),
      desktopInstallUpdate: vi.fn().mockResolvedValue({ started: false }),
    };
    const el = make(api);
    await el.open();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any)._confirm();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._updating).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._error).not.toBe("");
  });

  it("holds the updating state when the update starts", async () => {
    const api = {
      desktopCheckUpdate: vi.fn().mockResolvedValue(makeCheck(true)),
      desktopInstallUpdate: vi.fn().mockResolvedValue({ started: true }),
    };
    const el = make(api);
    await el.open();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any)._confirm();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._updating).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._error).toBe("");
  });
});
