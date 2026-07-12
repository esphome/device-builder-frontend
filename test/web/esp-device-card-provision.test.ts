// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const openImprovDialog = vi.fn((..._a: unknown[]) =>
  Promise.resolve({ improv: true, provisioned: true })
);
vi.mock("../../src/web/improv/open-improv-dialog.js", () => ({
  openImprovDialog: (...a: unknown[]) => openImprovDialog(...a),
  IMPROV_OPEN_DELAY_MS: 0,
}));
// sleep resolves instantly so the sequencing is deterministic in tests.
vi.mock("../../src/util/sleep.js", () => ({ sleep: () => Promise.resolve() }));

// Heavy child modules — only their side-effect registration matters here.
vi.mock("../../src/web/install/esphome-web-install-adoptable-dialog.js", () => ({}));
vi.mock("../../src/web/install/esphome-web-install-upload-dialog.js", () => ({}));
vi.mock("../../src/web/logs/esphome-web-logs-dialog.js", () => ({}));
vi.mock("../../src/web/dashboard/esphome-web-card.js", () => ({}));
vi.mock("../../src/util/register-icons.js", () => ({ registerMdiIcons: vi.fn() }));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeWebEspDeviceCard } from "../../src/web/dashboard/esphome-web-esp-device-card.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const port = { id: "p" } as unknown as SerialPort;

async function mount(): Promise<ESPHomeWebEspDeviceCard> {
  const el = new ESPHomeWebEspDeviceCard();
  (el as any)._localize = (k: string) => k;
  el.port = port;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("esphome-web-esp-device-card Improv hand-off", () => {
  it("closes the adoptable dialog before opening Improv", async () => {
    const el = await mount();
    (el as any)._adoptableOpen = true;

    await (el as any)._onProvisionWifi();

    // Modal closed first, then Improv opened on the same port.
    expect((el as any)._adoptableOpen).toBe(false);
    expect(openImprovDialog).toHaveBeenCalledOnce();
    expect(openImprovDialog).toHaveBeenCalledWith(port, expect.any(Function));
  });

  it("opens Improv directly for the manual Configure Wi-Fi action", async () => {
    const el = await mount();

    (el as any)._configureWifi();

    expect(openImprovDialog).toHaveBeenCalledOnce();
  });
});
