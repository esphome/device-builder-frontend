// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const openImprovDialog = vi.fn();
vi.mock("../../src/web/improv/open-improv-dialog.js", () => ({
  openImprovDialog: (...a: unknown[]) => openImprovDialog(...a),
  IMPROV_OPEN_DELAY_MS: 0,
}));
vi.mock("../../src/util/sleep.js", () => ({ sleep: () => Promise.resolve() }));

vi.mock("../../src/web/install/esphome-web-install-pico-dialog.js", () => ({}));
vi.mock("../../src/web/dashboard/esphome-web-card.js", () => ({}));
vi.mock("../../src/web/dashboard/esphome-web-pico-device-card.js", () => ({}));
vi.mock("../../src/util/register-icons.js", () => ({ registerMdiIcons: vi.fn() }));
const reacquirePort = vi.fn();
vi.mock("../../src/util/web-serial.js", () => ({
  isPortPickerCancel: vi.fn(() => false),
  reacquirePort: (...a: unknown[]) => reacquirePort(...a),
}));
vi.mock("../../src/web/util/pico-port-filter.js", () => ({ picoPortFilters: [] }));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { flush } from "../_dom.js";
import { makeDisconnectPort } from "../_web-serial.js";
import { ESPHomeWebPicoConnectCard } from "../../src/web/dashboard/esphome-web-pico-connect-card.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const port = {
  id: "pico",
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
} as unknown as SerialPort;

async function mount(): Promise<ESPHomeWebPicoConnectCard> {
  const el = new ESPHomeWebPicoConnectCard();
  (el as any)._localize = (k: string) => k;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("esphome-web-pico-connect-card first-time setup", () => {
  it("adopts the port only after Improv confirms the device (improv === true)", async () => {
    openImprovDialog.mockResolvedValue({ improv: true, provisioned: false });
    const el = await mount();

    await (el as any)._onPicoConnected(
      new CustomEvent("pico-connected", { detail: port })
    );

    expect((el as any)._setupOpen).toBe(false);
    expect(openImprovDialog).toHaveBeenCalledWith(port, expect.any(Function));
    expect((el as any)._port).toBe(port);
  });

  it("does NOT adopt when Improv was not detected (improv === false)", async () => {
    openImprovDialog.mockResolvedValue({ improv: false, provisioned: false });
    const el = await mount();

    await (el as any)._onPicoConnected(
      new CustomEvent("pico-connected", { detail: port })
    );

    expect(openImprovDialog).toHaveBeenCalledOnce();
    expect((el as any)._port).toBeUndefined();
  });
});

describe("esphome-web-pico-connect-card disconnect resilience", () => {
  it("folds a dialog-recovered handle in via port-replaced (composed hop)", async () => {
    const adopted = makeDisconnectPort();
    const live = makeDisconnectPort();
    const el = await mount();
    (el as any)._adoptPort(adopted);
    await (el as any).updateComplete;

    // The logs dialog dispatches from inside the device card's shadow
    // root; give the stubbed card one so the event genuinely crosses a
    // shadow boundary — composed: true is what carries it out.
    const device = el.shadowRoot!.querySelector("esphome-web-pico-device-card")!;
    const inner = document.createElement("div");
    device.attachShadow({ mode: "open" }).appendChild(inner);
    inner.dispatchEvent(
      new CustomEvent("port-replaced", { detail: live, bubbles: true, composed: true })
    );

    expect((el as any)._port).toBe(live);
    expect(live.listenerCount()).toBe(1);
  });

  it("keeps the device card through a re-enum blip, rebinding the live handle", async () => {
    const adopted = makeDisconnectPort();
    const fresh = makeDisconnectPort();
    reacquirePort.mockResolvedValue(fresh);
    const el = await mount();

    (el as any)._adoptPort(adopted);
    adopted.fire();
    await flush();

    expect((el as any)._port).toBe(fresh);
  });

  it("falls back to the connect screen when the device stays gone", async () => {
    const adopted = makeDisconnectPort();
    reacquirePort.mockResolvedValue(null);
    const el = await mount();

    (el as any)._adoptPort(adopted);
    adopted.fire();
    await flush();

    expect((el as any)._port).toBeUndefined();
  });
});
