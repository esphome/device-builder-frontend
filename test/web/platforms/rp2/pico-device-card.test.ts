// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/web/improv/open-improv-dialog.js", () => ({
  openImprovDialog: vi.fn(),
  IMPROV_OPEN_DELAY_MS: 0,
}));
vi.mock("../../../../src/web/logs/esphome-web-logs-dialog.js", () => ({}));
vi.mock("../../../../src/web/logs/open-port-for-logs.js", () => ({
  openPortForLogs: vi.fn(),
}));
vi.mock("../../../../src/web/dashboard/esphome-web-card.js", () => ({}));
vi.mock("../../../../src/util/register-icons.js", () => ({ registerMdiIcons: vi.fn() }));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/tooltip/tooltip.js", () => ({}));

import { expectTooltipsAnchored } from "../../../_tooltip-anchors.js";
import { RP2_SERIAL_LOGS } from "../../../../src/platforms/rp2/serial-logs.js";
import { openPortForLogs } from "../../../../src/web/logs/open-port-for-logs.js";
import { ESPHomeWebPicoDeviceCard } from "../../../../src/web/platforms/rp2/esphome-web-pico-device-card.js";

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

  it("releases a logs port that opened after a flow switch removed the card", async () => {
    const el = new ESPHomeWebPicoDeviceCard();
    (el as any)._localize = (k: string) => k;
    const close = vi.fn(async () => {});
    el.port = { close } as unknown as SerialPort;
    document.body.appendChild(el);
    await el.updateComplete;
    let opened!: (ok: boolean) => void;
    vi.mocked(openPortForLogs).mockImplementation(
      () => new Promise<boolean>((resolve) => (opened = resolve))
    );
    const pending = (el as any)._showLogs();
    el.remove();
    opened(true);
    await pending;
    expect(close).toHaveBeenCalledTimes(1);
    expect((el as any)._logsOpen).toBe(false);
  });

  it("asks the logs dialog for the Pico's reboot reset", async () => {
    const el = new ESPHomeWebPicoDeviceCard();
    (el as any)._localize = (k: string) => k;
    el.port = {} as SerialPort;
    document.body.appendChild(el);
    await el.updateComplete;
    const dialog = el.shadowRoot!.querySelector("esphome-web-logs-dialog") as any;
    expect(dialog.policy).toBe(RP2_SERIAL_LOGS);
  });

  it("anchors every action tooltip to a real button id", async () => {
    const el = new ESPHomeWebPicoDeviceCard();
    (el as any)._localize = (k: string) => k;
    el.port = { close: vi.fn(async () => {}) } as unknown as SerialPort;
    document.body.appendChild(el);
    await el.updateComplete;
    expectTooltipsAnchored(el, 2);
  });
});
