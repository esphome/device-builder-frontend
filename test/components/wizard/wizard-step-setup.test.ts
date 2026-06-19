/**
 * @vitest-environment happy-dom
 *
 * Pins the create wizard's setup step: it collects Wi-Fi only when it's needed
 * (no shared secret yet, board has no own network), passes typed credentials
 * straight through for the backend to persist, and offers an explicit skip.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardCatalogEntry } from "../../../src/api/types/boards.js";
import { ESPHomeWizardStepSetup } from "../../../src/components/wizard/wizard-step-setup.js";
import { pressEnter } from "../../_press-enter.js";

async function mount(secretsYaml?: string): Promise<ESPHomeWizardStepSetup> {
  const el = new ESPHomeWizardStepSetup();
  const getConfig =
    secretsYaml === undefined
      ? vi.fn().mockRejectedValue(new Error("no secrets file"))
      : vi.fn().mockResolvedValue(secretsYaml);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._api = { getConfig };
  el.active = true; // the parent dialog is open
  document.body.appendChild(el);
  await el.updateComplete;
  // connectedCallback parses secrets.yaml asynchronously; let it settle.
  await Promise.resolve();
  await Promise.resolve();
  await el.updateComplete;
  return el;
}

function setName(el: ESPHomeWizardStepSetup, value: string): Promise<unknown> {
  const input = el.shadowRoot!.querySelector<HTMLInputElement>("#device-name")!;
  input.value = value;
  input.dispatchEvent(new Event("input"));
  return el.updateComplete;
}

function setSsid(el: ESPHomeWizardStepSetup, value: string): Promise<unknown> {
  const input = el.shadowRoot!.querySelector<HTMLInputElement>("#onboarding-ssid")!;
  input.value = value;
  input.dispatchEvent(new Event("input"));
  return el.updateComplete;
}

function networkedBoard(): BoardCatalogEntry {
  // Minimal board the render path touches, flagged as bringing its own network.
  return {
    id: "wt32-eth01",
    name: "WT32-ETH01",
    tags: [],
    images: [],
    provides_network: true,
  } as unknown as BoardCatalogEntry;
}

describe("wizard-step-setup", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("advances to the wifi stage on Enter when there's no shared secret", async () => {
    const el = await mount();
    await setName(el, "kitchen");
    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    pressEnter();
    expect(onFinish).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._stage).toBe("wifi");
  });

  it("skips the wifi stage and finishes when the board brings its own network", async () => {
    const el = await mount();
    el.board = networkedBoard();
    await el.updateComplete;
    await setName(el, "kitchen");
    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    pressEnter();
    expect(onFinish).toHaveBeenCalledTimes(1);
    const detail = (onFinish.mock.calls[0][0] as CustomEvent).detail;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._stage).toBe("name");
    expect(detail.wifiSsid).toBe("");
    expect(detail.skipWifi).toBe(false);
  });

  it("skips the wifi stage when secrets already define Wi-Fi", async () => {
    const el = await mount('wifi_ssid: "home"\nwifi_password: "pw"\n');
    await setName(el, "kitchen");
    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    pressEnter();
    expect(onFinish).toHaveBeenCalledTimes(1);
    const detail = (onFinish.mock.calls[0][0] as CustomEvent).detail;
    // Empty creds → backend reuses the existing !secret block; not a decline.
    expect(detail.wifiSsid).toBe("");
    expect(detail.wifiPassword).toBe("");
    expect(detail.skipWifi).toBe(false);
  });

  it("passes a typed SSID through unchanged for the backend to persist", async () => {
    const el = await mount();
    await setName(el, "kitchen");
    pressEnter(); // advance to wifi
    await el.updateComplete;
    await setSsid(el, "typed-network");
    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    pressEnter();
    const detail = (onFinish.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.wifiSsid).toBe("typed-network");
    expect(detail.skipWifi).toBe(false);
  });

  it("finishes with empty credentials when the wifi stage is left blank", async () => {
    const el = await mount();
    await setName(el, "kitchen");
    pressEnter(); // advance to wifi
    await el.updateComplete;
    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    pressEnter();
    expect(onFinish).toHaveBeenCalledTimes(1);
    const detail = (onFinish.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.wifiSsid).toBe("");
    expect(detail.skipWifi).toBe(false);
  });

  it("the skip-wifi button finishes with skipWifi true and no credentials", async () => {
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
    expect(detail.skipWifi).toBe(true);
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

  it("a held Enter does not skip past the wifi stage (no auto-finish on key-repeat)", async () => {
    const el = await mount();
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

  it("a fresh Enter on the wifi stage finishes", async () => {
    const el = await mount();
    await setName(el, "kitchen");
    pressEnter(); // advance to wifi
    await el.updateComplete;
    await setSsid(el, "home");
    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    pressEnter(); // a distinct press (repeat=false) finishes
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect((onFinish.mock.calls[0][0] as CustomEvent).detail.wifiSsid).toBe("home");
  });

  it("disables browser autofill on the name input", async () => {
    const el = await mount();
    const deviceName = el.shadowRoot!.querySelector<HTMLInputElement>("#device-name");
    expect(deviceName?.getAttribute("autocomplete")).toBe("off");
  });
});
