/**
 * @vitest-environment happy-dom
 *
 * Pins the create de-dupe that the wizard steps rely on instead of a
 * per-step latch: a second create event while one is in flight is dropped
 * (the _submitting guard), but a create after a failed attempt is allowed
 * so the user can retry — no permanent lockout.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("../../../src/components/wizard/wizard-step-board.js", () => ({}));
vi.mock("../../../src/components/wizard/wizard-step-empty-config.js", () => ({}));
vi.mock("../../../src/components/wizard/wizard-step-import-partial.js", () => ({}));
vi.mock("../../../src/components/wizard/wizard-step-method.js", () => ({}));
vi.mock("../../../src/components/wizard/wizard-step-overwrite-device.js", () => ({}));
vi.mock("../../../src/components/wizard/wizard-step-resolve-conflicts.js", () => ({}));
vi.mock("../../../src/components/wizard/wizard-step-setup.js", () => ({}));

import { APIError } from "../../../src/api/api-error.js";
import type { ESPHomeAPI } from "../../../src/api/index.js";
import { ESPHomeCreateConfigDialog } from "../../../src/components/wizard/create-config-dialog.js";

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

async function mount(api: Partial<ESPHomeAPI>): Promise<ESPHomeCreateConfigDialog> {
  const el = new ESPHomeCreateConfigDialog();
  // Entering the setup step upgrades the slim board via getBoard; default it so
  // navigation tests don't each have to wire it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._api = {
    getBoard: vi.fn(async (id: string) => ({ id })),
    ...api,
  } as ESPHomeAPI;
  document.body.appendChild(el);
  await el.updateComplete;
  el.open();
  await el.updateComplete;
  return el;
}

// The parent listens for create-empty-config on its esphome-base-dialog; emit
// it the way a wizard step would (bubbling, composed).
function emitCreate(el: ESPHomeCreateConfigDialog, name: string): void {
  const wd = el.shadowRoot!.querySelector("esphome-base-dialog")!;
  wd.dispatchEvent(
    new CustomEvent("create-empty-config", {
      detail: { name },
      bubbles: true,
      composed: true,
    })
  );
}

// Same shape for the basic-setup flow (board + WiFi + name).
function emitFinish(el: ESPHomeCreateConfigDialog, name: string): void {
  const wd = el.shadowRoot!.querySelector("esphome-base-dialog")!;
  wd.dispatchEvent(
    new CustomEvent("finish-setup", {
      detail: { board: { id: "esp32dev" }, name, wifiSsid: "net", wifiPassword: "pw" },
      bubbles: true,
      composed: true,
    })
  );
}

// The method step dispatches import-file with the picked File.
function emitImport(el: ESPHomeCreateConfigDialog, file: File): void {
  const wd = el.shadowRoot!.querySelector("esphome-base-dialog")!;
  wd.dispatchEvent(
    new CustomEvent("import-file", { detail: { file }, bubbles: true, composed: true })
  );
}

// The resolve-conflicts step dispatches the user's overwrite choices.
function emitResolve(el: ESPHomeCreateConfigDialog, overwrite: string[]): void {
  const wd = el.shadowRoot!.querySelector("esphome-base-dialog")!;
  wd.dispatchEvent(
    new CustomEvent("resolve-conflicts", {
      detail: { overwrite },
      bubbles: true,
      composed: true,
    })
  );
}

function bundleFile(): File {
  return new File(
    [new Uint8Array([0x1f, 0x8b, 0x08, 0x00])],
    "device.esphomebundle.tar.gz"
  );
}

function yamlFile(): File {
  return new File(["esphome:\n  name: device\n"], "device.yaml");
}

// The overwrite-confirm step dispatches this when the user confirms.
function emitOverwriteDevice(el: ESPHomeCreateConfigDialog): void {
  const wd = el.shadowRoot!.querySelector("esphome-base-dialog")!;
  wd.dispatchEvent(
    new CustomEvent("overwrite-device", { bubbles: true, composed: true })
  );
}

// The overwrite-confirm step's Cancel routes back via next-step.
function emitNextStep(el: ESPHomeCreateConfigDialog, step: string): void {
  const wd = el.shadowRoot!.querySelector("esphome-base-dialog")!;
  wd.dispatchEvent(
    new CustomEvent("next-step", { detail: step, bubbles: true, composed: true })
  );
}

describe("create-config-dialog create de-dupe + retry", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("drops a second create while the first is in flight", async () => {
    const inflight = deferred<{ configuration: string }>();
    const createDevice = vi.fn(() => inflight.promise);
    const el = await mount({ createDevice });

    emitCreate(el, "kitchen");
    emitCreate(el, "kitchen");

    expect(createDevice).toHaveBeenCalledTimes(1);
  });

  it("allows a retry after a failed create (no permanent lockout)", async () => {
    const createDevice = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ configuration: "kitchen.yaml" });
    const el = await mount({ createDevice });

    emitCreate(el, "kitchen"); // first attempt — fails
    await flush();
    emitCreate(el, "kitchen"); // retry — must not be blocked
    await flush();

    expect(createDevice).toHaveBeenCalledTimes(2);
  });

  it("forwards the raw display name so the backend keeps it as friendly_name", async () => {
    // The wizard must NOT slugify here; the backend derives the
    // hostname slug and preserves the descriptive name as
    // esphome.friendly_name (issue #1070).
    const createDevice = vi
      .fn()
      .mockResolvedValue({ configuration: "living-room-2.yaml" });
    const el = await mount({ createDevice });

    emitCreate(el, "Living Room #2");
    await flush();

    expect(createDevice).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Living Room #2" })
    );
  });

  it("forwards the raw display name from the basic-setup flow too", async () => {
    // Same slugify→raw change as the empty-config flow; the backend
    // derives the hostname and keeps the descriptive friendly_name.
    const createDevice = vi
      .fn()
      .mockResolvedValue({ configuration: "living-room-2.yaml" });
    const el = await mount({ createDevice });

    emitFinish(el, "Living Room #2");
    await flush();

    expect(createDevice).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Living Room #2",
        board_id: "esp32dev",
        config_type: "basic",
      })
    );
  });

  it("fires secrets-saved after a Wi-Fi create so secret pickers refresh", async () => {
    // The backend persists the SSID to secrets.yaml; without this event the
    // editor's secret pickers show the new !secret refs as missing until reload.
    const createDevice = vi.fn().mockResolvedValue({ configuration: "living-room.yaml" });
    const el = await mount({ createDevice });
    const onSaved = vi.fn();
    window.addEventListener("secrets-saved", onSaved);
    try {
      emitFinish(el, "Living Room"); // emitFinish sends wifiSsid: "net"
      await flush();
      expect(onSaved).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("secrets-saved", onSaved);
    }
  });
});

// A failed create shows a dialog-level error bar that outlives step changes.
// Navigating (Back, or forward into a new step with another board) must clear
// it so a stale message doesn't follow the user onto the next attempt (#1487).
describe("create-config-dialog stale error on navigation", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const errorText = (el: ESPHomeCreateConfigDialog): string | null =>
    el.shadowRoot!.querySelector("p.error")?.textContent ?? null;

  // Drive the dialog onto the setup step (where the Back button renders) by
  // dispatching the next-step a board pick would. Awaits the board upgrade the
  // dialog runs before showing setup.
  async function goToSetup(
    el: ESPHomeCreateConfigDialog,
    boardId = "esp32dev"
  ): Promise<void> {
    el.shadowRoot!.querySelector("esphome-base-dialog")!.dispatchEvent(
      new CustomEvent("next-step", {
        detail: { step: "setup", board: { id: boardId } },
        bubbles: true,
        composed: true,
      })
    );
    await flush();
    await el.updateComplete;
  }

  it("clears the error when pressing Back after a failed create", async () => {
    const createDevice = vi.fn().mockRejectedValue(new Error("boom"));
    const el = await mount({ createDevice });

    await goToSetup(el);
    emitFinish(el, "kitchen");
    await flush();
    await el.updateComplete;
    expect(errorText(el)).not.toBeNull();

    el.shadowRoot!.querySelector<HTMLButtonElement>(".back-button")!.click();
    await el.updateComplete;
    expect(errorText(el)).toBeNull();
  });

  it("clears the error on forward (next-step) navigation", async () => {
    const createDevice = vi.fn().mockRejectedValue(new Error("boom"));
    const el = await mount({ createDevice });

    await goToSetup(el, "esp32dev");
    emitFinish(el, "kitchen");
    await flush();
    await el.updateComplete;
    expect(errorText(el)).not.toBeNull();

    // Re-enter setup with a different board, as picking another board would.
    await goToSetup(el, "esp8266");
    expect(errorText(el)).toBeNull();
  });

  it("does not advance to setup with an error when the board body fails to load", async () => {
    // A failed getBoard must not advance to setup on the slim entry (whose
    // requires_wifi hydrates to false → could under-collect Wi-Fi).
    const getBoard = vi.fn().mockRejectedValue(new Error("offline"));
    const el = await mount({ getBoard });
    await goToSetup(el, "esp32dev");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._step).not.toBe("setup");
    expect(errorText(el)).not.toBeNull();
  });

  it("does not advance to setup with an error when getBoard returns null", async () => {
    const getBoard = vi.fn().mockResolvedValue(null);
    const el = await mount({ getBoard });
    await goToSetup(el, "esp32dev");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._step).not.toBe("setup");
    expect(errorText(el)).not.toBeNull();
  });
});

// The migration onto esphome-base-dialog swapped the imperative
// `_dialog.open = …` for a reactive `_open` flag. _onRequestClose flipping
// _open back to false is the load-bearing part — without it a user-driven
// close (Escape / X / outside-click) wouldn't dismiss. Pin the contract.
describe("create-config-dialog open/close contract", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const isOpen = (el: ESPHomeCreateConfigDialog): boolean =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._open;

  it("open() and openAtBoardStep() set the reactive open flag", async () => {
    const el = await mount({});
    expect(isOpen(el)).toBe(true);
    el.close();
    await el.updateComplete;
    expect(isOpen(el)).toBe(false);
    el.openAtBoardStep();
    expect(isOpen(el)).toBe(true);
  });

  it("flips _open to false on request-close from the wrapper", async () => {
    const el = await mount({});
    expect(isOpen(el)).toBe(true);
    el.shadowRoot!.querySelector("esphome-base-dialog")!.dispatchEvent(
      new CustomEvent("request-close")
    );
    expect(isOpen(el)).toBe(false);
  });

  it("close() sets _open to false", async () => {
    const el = await mount({});
    el.close();
    expect(isOpen(el)).toBe(false);
  });
});

// A .tar.gz is binary, so the wizard routes it to importBundle (base64)
// instead of reading it as text and shoving garbage into createDevice.
describe("create-config-dialog bundle import", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const step = (el: ESPHomeCreateConfigDialog): string =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._step;

  it("imports a bundle as base64 and never calls createDevice", async () => {
    const createDevice = vi.fn();
    const importBundle = vi.fn().mockResolvedValue({
      status: "imported",
      configuration: "device.yaml",
      conflicts: [],
      written: ["device.yaml"],
      kept: [],
      has_secrets: false,
      esphome_version: "2026.6.0",
    });
    const el = await mount({ createDevice, importBundle });

    emitImport(el, bundleFile());
    await flush();

    expect(createDevice).not.toHaveBeenCalled();
    expect(importBundle).toHaveBeenCalledTimes(1);
    const arg = importBundle.mock.calls[0][0];
    expect(arg.file_content_b64).toBeTruthy();
    expect(arg.overwrite).toBeUndefined();
  });

  it("routes a conflicts response to the resolve step, then re-submits the same bytes with overwrite", async () => {
    const importBundle = vi
      .fn()
      .mockResolvedValueOnce({
        status: "conflicts",
        configuration: "device.yaml",
        conflicts: ["device.yaml", "common/wifi.yaml"],
        has_secrets: true,
        esphome_version: "2026.6.0",
      })
      .mockResolvedValueOnce({
        status: "imported",
        configuration: "device.yaml",
        conflicts: [],
        written: ["device.yaml"],
        kept: [],
        has_secrets: true,
        esphome_version: "2026.6.0",
      });
    const el = await mount({ importBundle });

    emitImport(el, bundleFile());
    await flush();
    await el.updateComplete;

    expect(step(el)).toBe("resolve-conflicts");
    const firstB64 = importBundle.mock.calls[0][0].file_content_b64;

    emitResolve(el, ["device.yaml"]);
    await flush();

    expect(importBundle).toHaveBeenCalledTimes(2);
    const secondArg = importBundle.mock.calls[1][0];
    expect(secondArg.overwrite).toEqual(["device.yaml"]);
    // Same cached bytes re-sent; the file isn't re-read.
    expect(secondArg.file_content_b64).toBe(firstB64);
  });

  it("ignores a second Import click while a resolve submit is in flight", async () => {
    const inflight = deferred<{ status: string }>();
    const importBundle = vi
      .fn()
      .mockResolvedValueOnce({
        status: "conflicts",
        configuration: "device.yaml",
        conflicts: ["device.yaml"],
        has_secrets: false,
        esphome_version: "2026.6.0",
      })
      .mockReturnValueOnce(inflight.promise);
    const el = await mount({ importBundle });

    emitImport(el, bundleFile());
    await flush();
    await el.updateComplete;

    emitResolve(el, ["device.yaml"]);
    emitResolve(el, ["device.yaml"]); // double-click while first is in flight
    await flush();

    // Initial conflicts call + one resolve call; the double-click is dropped.
    expect(importBundle).toHaveBeenCalledTimes(2);
  });

  it("guards a double-click on the first import (across the file-read window)", async () => {
    const inflight = deferred<{ status: string }>();
    const importBundle = vi.fn().mockReturnValueOnce(inflight.promise);
    const el = await mount({ importBundle });

    // Two synchronous picks before the awaited arrayBuffer() resolves.
    emitImport(el, bundleFile());
    emitImport(el, bundleFile());
    await flush();

    expect(importBundle).toHaveBeenCalledTimes(1);
  });

  it("shows a distinct partial-import result when the backend keeps files", async () => {
    const importBundle = vi.fn().mockResolvedValue({
      status: "imported",
      configuration: "device.yaml",
      conflicts: [],
      written: ["common/new.yaml"],
      kept: ["device.yaml", "common/wifi.yaml"],
      has_secrets: false,
      esphome_version: "2026.6.0",
    });
    const el = await mount({ importBundle });

    emitImport(el, bundleFile());
    await flush();
    await el.updateComplete;

    expect(step(el)).toBe("import-partial");
    // Assert the observable output: the kept list the dialog hands to the
    // rendered partial-import step, not the controller's private field.
    const partialStep = el.shadowRoot!.querySelector(
      "esphome-wizard-step-import-partial"
    );
    expect(partialStep).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((partialStep as any).kept).toEqual(["device.yaml", "common/wifi.yaml"]);
  });
});

// A YAML upload that collides routes to a confirm step; confirming
// re-sends with overwrite:true (the backend keeps the device's labels).
describe("create-config-dialog upload overwrite", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const step = (el: ESPHomeCreateConfigDialog): string =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._step;

  it("routes an already_exists collision to the confirm-overwrite step", async () => {
    const createDevice = vi
      .fn()
      .mockRejectedValueOnce(
        new APIError("already_exists", "Configuration device.yaml already exists")
      );
    const el = await mount({ createDevice });

    emitImport(el, yamlFile());
    await flush();
    await el.updateComplete;

    expect(step(el)).toBe("confirm-overwrite");
    expect(createDevice).toHaveBeenCalledTimes(1);
    expect(createDevice.mock.calls[0][0].overwrite).toBeUndefined();
  });

  it("re-sends with overwrite:true when the user confirms", async () => {
    const createDevice = vi
      .fn()
      .mockRejectedValueOnce(new APIError("already_exists", "exists"))
      .mockResolvedValueOnce({ configuration: "device.yaml" });
    const el = await mount({ createDevice });

    emitImport(el, yamlFile());
    await flush();
    await el.updateComplete;

    emitOverwriteDevice(el);
    await flush();

    expect(createDevice).toHaveBeenCalledTimes(2);
    expect(createDevice.mock.calls[1][0].overwrite).toBe(true);
  });

  it("cancelling the confirm step does not re-call createDevice", async () => {
    const createDevice = vi
      .fn()
      .mockRejectedValueOnce(new APIError("already_exists", "exists"));
    const el = await mount({ createDevice });

    emitImport(el, yamlFile());
    await flush();
    await el.updateComplete;

    emitNextStep(el, "method"); // Cancel
    await flush();

    expect(step(el)).toBe("method");
    expect(createDevice).toHaveBeenCalledTimes(1);
  });

  it("a non-collision upload error stays on the method step", async () => {
    const createDevice = vi
      .fn()
      .mockRejectedValueOnce(new APIError("invalid_args", "bad yaml"));
    const el = await mount({ createDevice });

    emitImport(el, yamlFile());
    await flush();
    await el.updateComplete;

    expect(step(el)).toBe("method");
    expect(createDevice).toHaveBeenCalledTimes(1);
  });
});

// The "Advanced" disclosure flag lives on the dialog (not the method step) so
// it survives the method element being unmounted and re-created when the user
// navigates into an advanced option (empty-config / import) and back.
describe("create-config-dialog advanced disclosure persistence", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const methodEl = (el: ESPHomeCreateConfigDialog): HTMLElement | null =>
    el.shadowRoot!.querySelector("esphome-wizard-step-method");

  const advancedOpen = (el: ESPHomeCreateConfigDialog): boolean | undefined =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (methodEl(el) as any)?.advancedOpen;

  function toggleAdvanced(el: ESPHomeCreateConfigDialog): void {
    el.shadowRoot!.querySelector("esphome-base-dialog")!.dispatchEvent(
      new CustomEvent("toggle-advanced", { bubbles: true, composed: true })
    );
  }

  it("keeps Advanced open when navigating into empty-config and back", async () => {
    const el = await mount({});
    expect(advancedOpen(el)).toBe(false);

    toggleAdvanced(el);
    await el.updateComplete;
    expect(advancedOpen(el)).toBe(true);

    // Into the advanced option — the method element unmounts.
    emitNextStep(el, "empty-config");
    await el.updateComplete;
    expect(methodEl(el)).toBeNull();

    // Back to the chooser — the re-mounted method step still gets it open.
    emitNextStep(el, "method");
    await el.updateComplete;
    expect(advancedOpen(el)).toBe(true);
  });

  it("starts collapsed again after the dialog is reopened", async () => {
    const el = await mount({});
    toggleAdvanced(el);
    await el.updateComplete;
    expect(advancedOpen(el)).toBe(true);

    el.close();
    await el.updateComplete;
    el.open();
    await el.updateComplete;
    expect(advancedOpen(el)).toBe(false);
  });
});
