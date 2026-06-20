/**
 * @vitest-environment happy-dom
 *
 * Pins the create wizard's setup step: it collects Wi-Fi only for a board that
 * needs it (native Wi-Fi, no onboard network, no shared secret yet) and makes
 * the SSID mandatory there; every other board finishes straight from the name
 * stage. Typed credentials pass through for the backend to persist.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardCatalogEntry } from "../../../src/api/types/boards.js";
import { ESPHomeWizardStepSetup } from "../../../src/components/wizard/wizard-step-setup.js";
import { fetchSecretKeys } from "../../../src/util/secrets-cache.js";
import { pressEnter } from "../../_press-enter.js";

// connectedCallback reads the shared (session-cached) secret-keys list to
// decide whether Wi-Fi is already configured; mock it per-test (no cache bleed).
vi.mock("../../../src/util/secrets-cache.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/util/secrets-cache.js")>()),
  fetchSecretKeys: vi.fn(async () => [] as string[]),
}));

beforeEach(() => {
  vi.mocked(fetchSecretKeys).mockResolvedValue([]);
});

function board(flags: Partial<BoardCatalogEntry>): BoardCatalogEntry {
  return {
    id: "b",
    name: "Board",
    tags: [],
    images: [],
    ...flags,
  } as unknown as BoardCatalogEntry;
}

// A Wi-Fi-only board (native Wi-Fi, no onboard network) → wizard collects Wi-Fi.
const wifiBoard = () => board({ requires_wifi: true });
// Any board that doesn't require Wi-Fi (Ethernet/Thread, or no network
// hardware) → the Wi-Fi step is skipped.
const noWifiBoard = () => board({ requires_wifi: false });

async function mount(
  boardEntry: BoardCatalogEntry,
  secretKeys: string[] = []
): Promise<ESPHomeWizardStepSetup> {
  vi.mocked(fetchSecretKeys).mockResolvedValue(secretKeys);
  const el = new ESPHomeWizardStepSetup();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._api = {};
  el.board = boardEntry;
  el.active = true; // the parent dialog is open
  document.body.appendChild(el);
  await el.updateComplete;
  // connectedCallback reads secret keys asynchronously; let it settle.
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stage = (el: ESPHomeWizardStepSetup) => (el as any)._stage;

describe("wizard-step-setup", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("advances to the Wi-Fi stage for a Wi-Fi-only board with no secret", async () => {
    const el = await mount(wifiBoard());
    await setName(el, "kitchen");
    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    pressEnter();
    expect(onFinish).not.toHaveBeenCalled();
    expect(stage(el)).toBe("wifi");
  });

  it("never shows a skip link on the Wi-Fi stage", async () => {
    const el = await mount(wifiBoard());
    await setName(el, "kitchen");
    pressEnter();
    await el.updateComplete;
    expect(stage(el)).toBe("wifi");
    expect(el.shadowRoot!.querySelector(".skip-wifi")).toBeNull();
  });

  it("requires an SSID to finish a Wi-Fi-only board", async () => {
    const el = await mount(wifiBoard());
    await setName(el, "kitchen");
    pressEnter(); // advance to wifi
    await el.updateComplete;
    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    pressEnter(); // blank SSID → blocked
    expect(onFinish).not.toHaveBeenCalled();
    await setSsid(el, "myssid");
    pressEnter(); // SSID entered → finishes
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect((onFinish.mock.calls[0][0] as CustomEvent).detail.wifiSsid).toBe("myssid");
  });

  it("does not finish with a password but a blank SSID", async () => {
    const el = await mount(wifiBoard());
    await setName(el, "kitchen");
    pressEnter();
    await el.updateComplete;
    const pw = el.shadowRoot!.querySelector("esphome-password-input")!;
    pw.dispatchEvent(
      new CustomEvent("password-input-change", {
        detail: { value: "hunter2" },
        bubbles: true,
        composed: true,
      })
    );
    await el.updateComplete;
    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    pressEnter();
    expect(onFinish).not.toHaveBeenCalled();
    expect(stage(el)).toBe("wifi");
  });

  it("skips the Wi-Fi stage and finishes for a board that doesn't require Wi-Fi", async () => {
    // Ethernet/Thread or no-network-hardware boards alike: nothing to ask, so
    // finish straight from the name stage (backend uses the board's network or
    // a no-network stub).
    const el = await mount(noWifiBoard());
    await setName(el, "kitchen");
    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    pressEnter();
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(stage(el)).toBe("name");
    expect((onFinish.mock.calls[0][0] as CustomEvent).detail.wifiSsid).toBe("");
  });

  it("skips the Wi-Fi stage when secrets already define Wi-Fi", async () => {
    const el = await mount(wifiBoard(), ["wifi_ssid", "wifi_password"]);
    await setName(el, "kitchen");
    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    pressEnter();
    expect(onFinish).toHaveBeenCalledTimes(1);
    // Empty creds → backend reuses the existing !secret block.
    const detail = (onFinish.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.wifiSsid).toBe("");
    expect(detail.wifiPassword).toBe("");
  });

  it("passes a typed SSID through unchanged for the backend to persist", async () => {
    const el = await mount(wifiBoard());
    await setName(el, "kitchen");
    pressEnter();
    await el.updateComplete;
    await setSsid(el, "typed-network");
    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    pressEnter();
    expect((onFinish.mock.calls[0][0] as CustomEvent).detail.wifiSsid).toBe(
      "typed-network"
    );
  });

  it("does nothing on Enter with a blank name", async () => {
    const el = await mount(wifiBoard());
    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    pressEnter();
    expect(onFinish).not.toHaveBeenCalled();
    expect(stage(el)).toBe("name");
  });

  it("a held Enter does not skip past the Wi-Fi stage (no auto-finish on key-repeat)", async () => {
    const el = await mount(wifiBoard());
    await setName(el, "kitchen");
    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    pressEnter(); // first keydown advances to wifi
    expect(stage(el)).toBe("wifi");
    pressEnter({ repeat: true }); // same held key auto-repeats; ignored
    expect(onFinish).not.toHaveBeenCalled();
    expect(stage(el)).toBe("wifi");
  });

  it("a fresh Enter on the Wi-Fi stage finishes once an SSID is set", async () => {
    const el = await mount(wifiBoard());
    await setName(el, "kitchen");
    pressEnter(); // advance to wifi
    await el.updateComplete;
    await setSsid(el, "home");
    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    pressEnter();
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect((onFinish.mock.calls[0][0] as CustomEvent).detail.wifiSsid).toBe("home");
  });

  it("disables browser autofill on the name input", async () => {
    const el = await mount(wifiBoard());
    const deviceName = el.shadowRoot!.querySelector<HTMLInputElement>("#device-name");
    expect(deviceName?.getAttribute("autocomplete")).toBe("off");
  });
});
