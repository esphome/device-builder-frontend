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
  function livePort(): SerialPort & { dispatch: () => void } {
    const listeners = new Set<EventListener>();
    return {
      addEventListener: (_t: string, l: EventListener) => listeners.add(l),
      removeEventListener: (_t: string, l: EventListener) => listeners.delete(l),
      dispatch: () => [...listeners].forEach((l) => l(new Event("disconnect"))),
    } as unknown as SerialPort & { dispatch: () => void };
  }

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("keeps the device card through a re-enum blip, rebinding the live handle", async () => {
    const adopted = livePort();
    const fresh = livePort();
    reacquirePort.mockResolvedValue(fresh);
    const el = await mount();

    (el as any)._adoptPort(adopted);
    adopted.dispatch();
    await flush();

    expect((el as any)._port).toBe(fresh);
  });

  it("falls back to the connect screen when the device stays gone", async () => {
    const adopted = livePort();
    reacquirePort.mockResolvedValue(null);
    const el = await mount();

    (el as any)._adoptPort(adopted);
    adopted.dispatch();
    await flush();

    expect((el as any)._port).toBeUndefined();
  });
});
