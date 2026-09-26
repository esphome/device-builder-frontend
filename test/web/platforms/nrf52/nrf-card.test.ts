// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
  openPortForLogs: vi.fn(),
  pickBleNusDevice: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("../../../../src/web/logs/esphome-web-logs-dialog.js", () => ({}));
vi.mock("../../../../src/web/logs/open-port-for-logs.js", () => ({
  openPortForLogs: mocks.openPortForLogs,
}));
vi.mock("../../../../src/util/web-serial.js", () => ({
  requestSerialPort: mocks.requestSerialPort,
}));
vi.mock("../../../../src/platforms/nrf52/ble-nus-picker.js", () => ({
  pickBleNusDevice: mocks.pickBleNusDevice,
}));
vi.mock(
  "../../../../src/web/platforms/nrf52/esphome-web-install-nrf-dialog.js",
  () => ({})
);
vi.mock("../../../../src/web/dashboard/esphome-web-card.js", () => ({}));
vi.mock("../../../../src/util/register-icons.js", () => ({ registerMdiIcons: vi.fn() }));
vi.mock("sonner-js", () => ({ default: { error: mocks.toastError } }));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/tooltip/tooltip.js", () => ({}));

import { expectTooltipsAnchored } from "../../../_tooltip-anchors.js";
import { ESPHomeWebNrfCard } from "../../../../src/web/platforms/nrf52/esphome-web-nrf-card.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function mount(): Promise<ESPHomeWebNrfCard> {
  const el = new ESPHomeWebNrfCard();
  (el as any)._localize = (k: string) => k;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const logsDialog = (el: ESPHomeWebNrfCard) =>
  el.shadowRoot!.querySelector("esphome-web-logs-dialog") as any;

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("esphome-web-nrf-card", () => {
  it("anchors every action tooltip to a real button id", async () => {
    expectTooltipsAnchored(await mount(), 2);
  });

  it("opens the logs dialog on the picked, opened CDC port", async () => {
    const el = await mount();
    const port = { readable: null };
    mocks.requestSerialPort.mockResolvedValue(port);
    mocks.openPortForLogs.mockResolvedValue(true);
    await (el as any)._showSerialLogs();
    await el.updateComplete;
    expect(mocks.openPortForLogs).toHaveBeenCalledWith(port, expect.any(Function), {});
    expect(logsDialog(el).port).toBe(port);
    expect(logsDialog(el).bleDevice).toBeUndefined();
    expect(logsDialog(el).hasAttribute("open")).toBe(true);
    expect(logsDialog(el).reset).toBeUndefined();
  });

  it("stays closed when the picker is dismissed, fails, or the port will not open", async () => {
    const el = await mount();
    mocks.requestSerialPort.mockResolvedValue(null);
    await (el as any)._showSerialLogs();
    expect((el as any)._logs).toBeUndefined();

    mocks.requestSerialPort.mockRejectedValue(new Error("no serial"));
    await (el as any)._showSerialLogs();
    expect(mocks.toastError).toHaveBeenLastCalledWith("web.connect.failed");
    expect((el as any)._logs).toBeUndefined();

    mocks.requestSerialPort.mockResolvedValue({});
    mocks.openPortForLogs.mockResolvedValue(false);
    await (el as any)._showSerialLogs();
    expect((el as any)._logs).toBeUndefined();
  });

  it("opens the logs dialog on the chosen Bluetooth device, with no name to filter on", async () => {
    const el = await mount();
    const device = {};
    mocks.pickBleNusDevice.mockResolvedValue(device);
    await (el as any)._showBleLogs();
    await el.updateComplete;
    expect(mocks.pickBleNusDevice).toHaveBeenCalledWith(expect.any(Function), []);
    expect(logsDialog(el).bleDevice).toBe(device);
    expect(logsDialog(el).port).toBeUndefined();
    expect(logsDialog(el).hasAttribute("open")).toBe(true);
  });

  it("stays closed when the chooser yields nothing", async () => {
    const el = await mount();
    mocks.pickBleNusDevice.mockResolvedValue(null);
    await (el as any)._showBleLogs();
    expect((el as any)._logs).toBeUndefined();
  });

  it("ignores a second click while a chooser is up", async () => {
    const el = await mount();
    let resolvePick!: (d: unknown) => void;
    mocks.pickBleNusDevice.mockReturnValue(new Promise((r) => (resolvePick = r)));
    const first = (el as any)._showBleLogs();
    await (el as any)._showSerialLogs();
    expect(mocks.requestSerialPort).not.toHaveBeenCalled();
    resolvePick({});
    await first;
    await el.updateComplete;
    expect(logsDialog(el).hasAttribute("open")).toBe(true);
  });

  it("ignores a logs click until the previous session's hide has cleared it", async () => {
    const el = await mount();
    mocks.pickBleNusDevice.mockResolvedValue({});
    await (el as any)._showBleLogs();
    await el.updateComplete;
    // Dismissed, but after-hide (which clears the session) not fired yet.
    await (el as any)._showSerialLogs();
    expect(mocks.requestSerialPort).not.toHaveBeenCalled();
    logsDialog(el).dispatchEvent(new CustomEvent("after-hide"));
    await el.updateComplete;
    mocks.requestSerialPort.mockResolvedValue({ readable: null });
    mocks.openPortForLogs.mockResolvedValue(true);
    await (el as any)._showSerialLogs();
    expect(mocks.requestSerialPort).toHaveBeenCalledOnce();
  });

  it("forgets the source when the logs dialog hides", async () => {
    const el = await mount();
    mocks.pickBleNusDevice.mockResolvedValue({});
    await (el as any)._showBleLogs();
    await el.updateComplete;
    logsDialog(el).dispatchEvent(new CustomEvent("after-hide"));
    await el.updateComplete;
    expect(logsDialog(el).hasAttribute("open")).toBe(false);
    expect(logsDialog(el).bleDevice).toBeUndefined();
    // And the next session opens as usual.
    mocks.requestSerialPort.mockResolvedValue({ readable: null });
    mocks.openPortForLogs.mockResolvedValue(true);
    await (el as any)._showSerialLogs();
    await el.updateComplete;
    expect(logsDialog(el).hasAttribute("open")).toBe(true);
  });
});

describe("esphome-web-nrf-card port announcement", () => {
  it("announces the picked port before opening it for logs", async () => {
    const port = { getInfo: () => ({}) };
    mocks.requestSerialPort.mockResolvedValue(port);
    mocks.openPortForLogs.mockResolvedValue(true);
    const el = await mount();
    const picked = vi.fn();
    el.addEventListener("port-picked", (e) => picked((e as CustomEvent).detail));
    await (el as any)._showSerialLogs();
    expect(picked).toHaveBeenCalledWith(port);
  });
});

describe("esphome-web-nrf-card unmounted mid-open", () => {
  it("releases a port that opened after a flow switch removed the card", async () => {
    const port = { getInfo: () => ({}), close: vi.fn(async () => {}) };
    mocks.requestSerialPort.mockResolvedValue(port);
    let opened!: (ok: boolean) => void;
    mocks.openPortForLogs.mockImplementation(
      () => new Promise<boolean>((resolve) => (opened = resolve))
    );
    const el = await mount();
    const pending = (el as any)._showSerialLogs();
    // Let the pick resolve so the open is in flight, then unmount the card.
    for (let i = 0; i < 4; i++) await Promise.resolve();
    el.remove();
    opened(true);
    await pending;
    expect(port.close).toHaveBeenCalledTimes(1);
    expect((el as any)._logs).toBeUndefined();
  });
});
