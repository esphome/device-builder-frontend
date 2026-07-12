// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/web/improv/open-improv-dialog.js", () => ({
  openImprovDialog: vi.fn(),
  IMPROV_OPEN_DELAY_MS: 0,
}));
vi.mock("../../src/web/logs/esphome-web-logs-dialog.js", () => ({
  openPortForLogs: vi.fn(),
}));
vi.mock("../../src/web/dashboard/esphome-web-card.js", () => ({}));
vi.mock("../../src/util/register-icons.js", () => ({ registerMdiIcons: vi.fn() }));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeWebPicoDeviceCard } from "../../src/web/dashboard/esphome-web-pico-device-card.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("esphome-web-pico-device-card", () => {
  it("closes the port and fires close on disconnect", () => {
    const el = new ESPHomeWebPicoDeviceCard();
    (el as any)._localize = (k: string) => k;
    const close = vi.fn(async () => {});
    el.port = { close } as unknown as SerialPort;
    const closed = vi.fn();
    el.addEventListener("close", closed);

    (el as any)._disconnect();

    expect(close).toHaveBeenCalledOnce();
    expect(closed).toHaveBeenCalledOnce();
  });
});
