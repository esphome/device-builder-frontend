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
vi.mock("../../src/util/web-serial.js", () => ({
  isPortPickerCancel: vi.fn(() => false),
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
