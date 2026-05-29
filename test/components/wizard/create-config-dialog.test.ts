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

// The parent listens for create-empty-config on its wa-dialog; emit it the
// way a wizard step would (bubbling, composed).
function emitCreate(el: ESPHomeCreateConfigDialog, name: string): void {
  const wd = el.shadowRoot!.querySelector("wa-dialog")!;
  wd.dispatchEvent(
    new CustomEvent("create-empty-config", {
      detail: { name },
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
});
