// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

// runFlash drives the flow straight to "done" so the dialog shows its Continue
// (Wi-Fi hand-off) button without touching real serial/firmware code.
vi.mock("../../src/web/install/run-flash.js", () => ({
  runFlash: vi.fn(
    async (_port: unknown, _plan: unknown, hooks: { onStep(step: string): void }) => {
      hooks.onStep("done");
      return true;
    }
  ),
}));
vi.mock("../../src/components/base-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/button/button.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/checkbox/checkbox.js", () => ({}));

import { ESPHomeWebInstallAdoptableDialog } from "../../src/web/install/esphome-web-install-adoptable-dialog.js";
import { runFlash } from "../../src/web/install/run-flash.js";

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

describe("esphome-web-install-adoptable-dialog erase option", () => {
  it("flashes without erasing by default", async () => {
    const el = await mount();
    await (el as any)._install();
    expect(vi.mocked(runFlash).mock.calls[0][1]).toMatchObject({ erase: false });
  });

  it("asks the flow to erase first when the checkbox is ticked", async () => {
    const el = await mount();
    const box = el.shadowRoot!.querySelector("wa-checkbox") as HTMLElement & {
      checked: boolean;
    };
    expect(box).toBeTruthy();
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    await el.updateComplete;

    await (el as any)._install();
    expect(vi.mocked(runFlash).mock.calls[0][1]).toMatchObject({ erase: true });
  });

  it("forgets the erase choice when the dialog closes", async () => {
    const el = await mount();
    (el as any)._erase = true;
    (el as any)._onAfterHide();
    expect((el as any)._erase).toBe(false);
  });
});
