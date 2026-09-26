// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const openImprovDialog = vi.fn();
vi.mock("../../../../src/web/improv/open-improv-dialog.js", () => ({
  openImprovDialog: (...a: unknown[]) => openImprovDialog(...a),
  IMPROV_OPEN_DELAY_MS: 0,
}));
vi.mock("../../../../src/util/sleep.js", () => ({ sleep: () => Promise.resolve() }));

vi.mock(
  "../../../../src/web/platforms/rp2/esphome-web-install-pico-dialog.js",
  () => ({})
);
vi.mock("../../../../src/web/dashboard/esphome-web-card.js", () => ({}));
vi.mock("../../../../src/web/platforms/rp2/esphome-web-pico-device-card.js", () => ({}));
vi.mock("../../../../src/util/register-icons.js", () => ({ registerMdiIcons: vi.fn() }));
const reacquirePort = vi.fn();
vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));
vi.mock("../../../../src/util/serial-reacquire.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reacquirePort: (...a: unknown[]) => reacquirePort(...a),
}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/tooltip/tooltip.js", () => ({}));

import toast from "sonner-js";

import { makeUsbPort } from "../../_make-web-serial-port.js";
import { flush } from "../../../_dom.js";
import { makeDisconnectPort } from "../../../_web-serial.js";
import { ESPHomeWebPicoConnectCard } from "../../../../src/web/platforms/rp2/esphome-web-pico-connect-card.js";

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
    expect(openImprovDialog).toHaveBeenCalledWith(port, expect.any(Function), {
      keepLines: true,
    });
    expect((el as any)._port).toBe(port);
  });

  it("skips Wi-Fi setup when a flow switch removed the card during the pause", async () => {
    const el = await mount();
    el.remove();
    await (el as any)._onPicoConnected(
      new CustomEvent("pico-connected", { detail: port })
    );
    expect(openImprovDialog).not.toHaveBeenCalled();
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

describe("esphome-web-pico-connect-card connect", () => {
  const pick = (picked: SerialPort) =>
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: { requestPort: vi.fn(async () => picked) },
    });

  it("adopts a Pico's own port", async () => {
    const el = await mount();
    pick(
      Object.assign(makeUsbPort(0x2e8a, 0xf00a), {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })
    );
    await (el as any)._connect();
    expect((el as any)._port).toBeDefined();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("turns away a Raspberry Pi debug probe the widened picker also lists", async () => {
    const el = await mount();
    pick(makeUsbPort(0x2e8a, 0x000c));
    await (el as any)._connect();
    expect((el as any)._port).toBeUndefined();
    expect(toast.error).toHaveBeenCalledWith("web.pico.probe_picked");
  });
});
