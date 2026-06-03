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
vi.mock("../../../src/components/wizard/wizard-step-method.js", () => ({}));
vi.mock("../../../src/components/wizard/wizard-step-setup.js", () => ({}));

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._api = api as ESPHomeAPI;
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
