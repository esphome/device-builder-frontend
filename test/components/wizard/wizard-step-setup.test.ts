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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._secretHasWifiPasswordKey = true;
    await setName(el, "kitchen");
    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    pressEnter();
    expect(onFinish).toHaveBeenCalledTimes(1);
    const detail = (onFinish.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.name).toBe("kitchen");
    // Empty so the backend emits unquoted !secret tags, not a literal string.
    expect(detail.wifiSsid).toBe("");
    expect(detail.wifiPassword).toBe("");
  });

  it("sends empty ssid when the prefilled secret value is kept on the wifi stage", async () => {
    const el = await mount();
    // SSID-only secret prefills the ssid field and lands on the wifi stage
    // (both secrets would skip it via _hasSecretWifi).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._secretWifiSsid = "homessid";
    await setName(el, "kitchen");
    pressEnter(); // advance to wifi; ssid prefilled from the secret
    await el.updateComplete;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._stage).toBe("wifi");

    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    pressEnter(); // keep the prefilled ssid
    expect(onFinish).toHaveBeenCalledTimes(1);
    const detail = (onFinish.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.wifiSsid).toBe("");
  });

  it("passes a typed wifi value through unchanged (not a secret reference)", async () => {
    const el = await mount();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._secretWifiSsid = "homessid";
    await setName(el, "kitchen");
    pressEnter(); // advance to wifi
    await el.updateComplete;
    const input = el.shadowRoot!.querySelector<HTMLInputElement>("#wifi-ssid")!;
    input.value = "typed-network";
    input.dispatchEvent(new Event("input"));
    await el.updateComplete;

    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    pressEnter();
    expect((onFinish.mock.calls[0][0] as CustomEvent).detail.wifiSsid).toBe(
      "typed-network"
    );
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

  it("auto-skips the wifi stage for an open-network secret (ssid set, empty password)", async () => {
    // The backend treats a wifi_password key (even empty) + non-empty ssid as
    // defined and emits !secret. The wizard must agree: auto-skip the wifi
    // stage so the skip button can't later produce a !secret config the user
    // declined. Drive the real secrets parse via getConfig.
    const el = new ESPHomeWizardStepSetup();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._api = {
      getConfig: vi.fn().mockResolvedValue('wifi_ssid: "home"\nwifi_password: ""\n'),
    };
    el.active = true;
    document.body.appendChild(el);
    await el.updateComplete;
    await Promise.resolve();

    await setName(el, "kitchen");
    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    pressEnter();

    // Finished straight from the name stage — the wifi stage was skipped — and
    // sends empty creds so the backend emits the !secret block.
    expect(onFinish).toHaveBeenCalledTimes(1);
    const detail = (onFinish.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.wifiSsid).toBe("");
    expect(detail.wifiPassword).toBe("");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._stage).toBe("name");
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

  it("finishes with empty credentials when the wifi stage is left blank", async () => {
    const el = await mount();
    await setName(el, "kitchen");
    pressEnter(); // advance to wifi (no secret prefill)
    await el.updateComplete;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._stage).toBe("wifi");

    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    pressEnter(); // blank ssid is allowed now — finish with no credentials
    expect(onFinish).toHaveBeenCalledTimes(1);
    const detail = (onFinish.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.wifiSsid).toBe("");
    expect(detail.wifiPassword).toBe("");
  });

  it("the skip-wifi button finishes with empty credentials", async () => {
    const el = await mount();
    await setName(el, "kitchen");
    pressEnter(); // advance to wifi
    await el.updateComplete;

    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    el.shadowRoot!.querySelector<HTMLButtonElement>(".skip-wifi")!.click();

    expect(onFinish).toHaveBeenCalledTimes(1);
    const detail = (onFinish.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.name).toBe("kitchen");
    expect(detail.wifiSsid).toBe("");
    expect(detail.wifiPassword).toBe("");
  });

  it("disables browser autofill on the name and wifi inputs", async () => {
    const el = await mount();
    const deviceName = el.shadowRoot!.querySelector<HTMLInputElement>("#device-name");
    expect(deviceName?.getAttribute("autocomplete")).toBe("off");

    await setName(el, "kitchen");
    pressEnter(); // advance to the wifi stage so its inputs render
    await el.updateComplete;
    for (const id of ["wifi-ssid", "wifi-password"]) {
      const input = el.shadowRoot!.querySelector<HTMLInputElement>(`#${id}`);
      expect(input?.getAttribute("autocomplete")).toBe("off");
    }
  });
});
