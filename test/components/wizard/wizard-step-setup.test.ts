/**
 * @vitest-environment happy-dom
 *
 * Pins Enter handling on the board setup step: it advances / finishes the
 * current stage, mirroring the primary button, and never acts on a blank name.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ESPHomeWizardStepSetup } from "../../../src/components/wizard/wizard-step-setup.js";
import { pressEnter } from "../../_press-enter.js";

async function mount(): Promise<ESPHomeWizardStepSetup> {
  const el = new ESPHomeWizardStepSetup();
  // No secrets file in the test; connectedCallback swallows the rejection.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._api = { getConfig: vi.fn().mockRejectedValue(new Error("none")) };
  el.active = true; // the parent dialog is open
  document.body.appendChild(el);
  await el.updateComplete;
  await Promise.resolve();
  return el;
}

function setName(el: ESPHomeWizardStepSetup, value: string): Promise<unknown> {
  const input = el.shadowRoot!.querySelector<HTMLInputElement>("#device-name")!;
  input.value = value;
  input.dispatchEvent(new Event("input"));
  return el.updateComplete;
}

describe("wizard-step-setup ENTER", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("finishes on Enter when wifi comes from secrets", async () => {
    const el = await mount();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._secretWifiSsid = "ssid";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._secretWifiPassword = "pw";
    await setName(el, "kitchen");
    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    pressEnter();
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect((onFinish.mock.calls[0][0] as CustomEvent).detail.name).toBe("kitchen");
  });

  it("advances to the wifi stage on Enter when there is no secret wifi", async () => {
    const el = await mount();
    await setName(el, "kitchen");
    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    pressEnter();
    expect(onFinish).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._stage).toBe("wifi");
  });

  it("does nothing on Enter with a blank name", async () => {
    const el = await mount();
    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    pressEnter();
    expect(onFinish).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._stage).toBe("name");
  });

  it("a held Enter does not skip the wifi stage (no auto-finish on key-repeat)", async () => {
    const el = await mount();
    // SSID-only secrets pre-fill the ssid on advance, satisfying the wifi
    // stage's _canAdvance() immediately; the dangerous case for a held Enter.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._secretWifiSsid = "ssid";
    await setName(el, "kitchen");
    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);

    pressEnter(); // first keydown advances to wifi
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._stage).toBe("wifi");

    pressEnter({ repeat: true }); // same held key auto-repeats; ignored
    expect(onFinish).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._stage).toBe("wifi");
  });

  it("a fresh Enter on the wifi stage still finishes", async () => {
    const el = await mount();
    await setName(el, "kitchen");
    pressEnter(); // advance to wifi
    await el.updateComplete; // let the wifi section render before querying it
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._stage).toBe("wifi");
    const input = el.shadowRoot!.querySelector<HTMLInputElement>("#wifi-ssid")!;
    input.value = "home";
    input.dispatchEvent(new Event("input"));
    await el.updateComplete;

    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    pressEnter(); // a distinct press (repeat=false) finishes
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect((onFinish.mock.calls[0][0] as CustomEvent).detail.wifiSsid).toBe("home");
  });
});
