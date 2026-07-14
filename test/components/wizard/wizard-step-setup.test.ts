/**
 * @vitest-environment happy-dom
 *
 * Pins the create wizard's setup step: it collects Wi-Fi only for a board that
 * needs it (native Wi-Fi, no onboard network, no shared secret yet) and makes
 * the SSID mandatory there; every other board finishes straight from the name
 * stage. Typed credentials pass through for the backend to persist.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardCatalogEntry } from "../../../src/api/types/boards.js";
import {
  clearTourPending,
  setTourActive,
  setTourPending,
} from "../../../src/components/guided-tour/tour-session.js";
import { ESPHomeWizardStepSetup } from "../../../src/components/wizard/wizard-step-setup.js";
import { fetchSecretKeys } from "../../../src/util/secrets-cache.js";
import { pressEnter } from "../../_press-enter.js";

// The real wa-checkbox is a form-associated element that crashes under happy-dom
// (no ElementInternals); the step only needs its checked/change contract, so
// render it as a plain unknown element.
vi.mock("@home-assistant/webawesome/dist/components/checkbox/checkbox.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));

// connectedCallback reads the shared (session-cached) secret-keys list to
// decide whether Wi-Fi is already configured; mock it per-test (no cache bleed).
vi.mock("../../../src/util/secrets-cache.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/util/secrets-cache.js")>()),
  fetchSecretKeys: vi.fn(async () => [] as string[]),
}));

beforeEach(() => {
  clearTourPending();
  setTourActive(false);
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
  it("advances to the Wi-Fi stage for a Wi-Fi-only board with no secret", async () => {
    const el = await mount(wifiBoard());
    await setName(el, "kitchen");
    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    pressEnter();
    expect(onFinish).not.toHaveBeenCalled();
    expect(stage(el)).toBe("wifi");
  });

  it("does not offer an unusable skip path before Wi-Fi is configured", async () => {
    const el = await mount(wifiBoard());
    await setName(el, "kitchen");
    pressEnter();
    await el.updateComplete;

    expect(stage(el)).toBe("wifi");
    expect(el.shadowRoot!.querySelector(".wifi-confirm")).toBeNull();
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

  it("shows saved Wi-Fi during the tour without revealing its values", async () => {
    setTourPending();
    setTourActive(true);
    const el = await mount(wifiBoard(), ["wifi_ssid", "wifi_password"]);
    await setName(el, "kitchen");
    pressEnter();
    await el.updateComplete;

    expect(stage(el)).toBe("wifi");
    expect(el.shadowRoot!.querySelector(".wifi-saved")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#onboarding-ssid")).toBeNull();
    expect(el.shadowRoot!.querySelector(".wifi-confirm")?.textContent).toContain(
      "wizard.wifi_use_saved"
    );
  });

  it("collects missing Wi-Fi during the tour instead of offering skip", async () => {
    setTourActive(true);
    const el = await mount(wifiBoard());
    await setName(el, "kitchen");
    pressEnter();
    await el.updateComplete;

    expect(stage(el)).toBe("wifi");
    expect(el.shadowRoot!.querySelector(".wifi-confirm")).toBeNull();
    expect(
      el.shadowRoot!.querySelector(".actions-right .btn-primary")?.textContent
    ).toContain("wizard.finish_setup");

    await setSsid(el, "tour-network");
    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    pressEnter();
    expect((onFinish.mock.calls[0][0] as CustomEvent).detail.wifiSsid).toBe(
      "tour-network"
    );
  });

  it("does not show saved Wi-Fi while the tour is paused", async () => {
    setTourPending();
    const el = await mount(wifiBoard(), ["wifi_ssid", "wifi_password"]);
    await setName(el, "kitchen");
    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);

    pressEnter();

    expect(onFinish).toHaveBeenCalledOnce();
    expect(stage(el)).toBe("name");
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

  // A complete onboard config with recommended components → offer "set up with
  // everything", pre-checked.
  const fullConfigBoard = () =>
    board({
      requires_wifi: false,
      full_config: true,
      featured_components: [{ id: "relay_1" }] as never,
      featured_bundles: [
        { id: "all_recommended", name: "x", component_ids: ["relay_1"] },
      ] as never,
    });

  it("offers a pre-checked full-setup option for a full-config board", async () => {
    const el = await mount(fullConfigBoard());
    expect(el.shadowRoot!.querySelector("wa-checkbox")).not.toBeNull();
    await setName(el, "kitchen");
    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    pressEnter();
    expect((onFinish.mock.calls[0][0] as CustomEvent).detail.fullSetup).toBe(true);
  });

  it("omits the full-setup option for an optional-component board", async () => {
    const el = await mount(noWifiBoard());
    expect(el.shadowRoot!.querySelector("wa-checkbox")).toBeNull();
    await setName(el, "kitchen");
    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    pressEnter();
    expect((onFinish.mock.calls[0][0] as CustomEvent).detail.fullSetup).toBe(false);
  });

  it("spins and disables both buttons while the parent reports submitting", async () => {
    const el = await mount(noWifiBoard());
    await setName(el, "kitchen");
    const primary = el.shadowRoot!.querySelector<HTMLButtonElement>(".btn-primary")!;
    const back = el.shadowRoot!.querySelector<HTMLButtonElement>(".btn-secondary")!;
    expect(primary.disabled).toBe(false);
    expect(primary.hasAttribute("aria-busy")).toBe(false);
    expect(el.shadowRoot!.querySelector("wa-spinner")).toBeNull();

    el.submitting = true;
    await el.updateComplete;
    expect(primary.disabled).toBe(true);
    expect(primary.getAttribute("aria-busy")).toBe("true");
    expect(back.disabled).toBe(true);
    expect(el.shadowRoot!.querySelector("wa-spinner")).not.toBeNull();

    // The parent clears the flag on success or failure; the spinner goes away
    // and a valid name is submittable again.
    el.submitting = false;
    await el.updateComplete;
    expect(primary.disabled).toBe(false);
    expect(el.shadowRoot!.querySelector("wa-spinner")).toBeNull();
  });

  it("ignores Enter while submitting so the keyboard can't re-dispatch finish", async () => {
    const el = await mount(noWifiBoard());
    await setName(el, "kitchen");
    el.submitting = true;
    await el.updateComplete;
    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    pressEnter();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("finishes without the full setup when the option is unchecked", async () => {
    const el = await mount(fullConfigBoard());
    await setName(el, "kitchen");
    const checkbox = el.shadowRoot!.querySelector<HTMLInputElement>("wa-checkbox")!;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change"));
    await el.updateComplete;
    const onFinish = vi.fn();
    el.addEventListener("finish-setup", onFinish as EventListener);
    pressEnter();
    expect((onFinish.mock.calls[0][0] as CustomEvent).detail.fullSetup).toBe(false);
  });
});
