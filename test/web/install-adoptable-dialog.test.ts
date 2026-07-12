// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

// runFlash drives the flow straight to "done" so the dialog shows its Continue
// (Wi-Fi hand-off) button without touching real serial/firmware code.
vi.mock("../../src/web/install/run-flash.js", () => ({
  runFlash: vi.fn(async (_port: unknown, _plan: unknown, hooks: any) => {
    hooks.onStep("done");
    return true;
  }),
}));
vi.mock("../../src/components/base-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/button/button.js", () => ({}));

import { ESPHomeWebInstallAdoptableDialog } from "../../src/web/install/esphome-web-install-adoptable-dialog.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function mount(): Promise<ESPHomeWebInstallAdoptableDialog> {
  const el = new ESPHomeWebInstallAdoptableDialog();
  (el as any)._localize = (k: string) => k;
  el.port = {} as SerialPort;
  el.open = true;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("esphome-web-install-adoptable-dialog Wi-Fi hand-off", () => {
  it("does NOT dispatch provision-wifi automatically on a successful install", async () => {
    const el = await mount();
    const spy = vi.fn();
    el.addEventListener("provision-wifi", spy);

    await (el as any)._install();
    await el.updateComplete;

    // Success leaves the dialog in its done state; Improv opens only on Continue
    // (once the parent closes this native modal).
    expect(spy).not.toHaveBeenCalled();
    expect((el as any)._flow.done).toBe(true);
  });

  it("dispatches provision-wifi when Continue is clicked", async () => {
    const el = await mount();
    const spy = vi.fn();
    el.addEventListener("provision-wifi", spy);

    await (el as any)._install();
    await el.updateComplete;
    (el as any)._continue();

    expect(spy).toHaveBeenCalledOnce();
  });
});
