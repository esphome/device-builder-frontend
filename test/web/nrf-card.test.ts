// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
  openPortForLogs: vi.fn(),
  requestBleNusDevice: vi.fn(),
  isWebBluetoothSupported: vi.fn(() => true),
  bleUnavailableReason: vi.fn<() => Promise<"off" | "brave" | null>>(async () => "off"),
  toastError: vi.fn(),
}));
vi.mock("../../src/web/logs/esphome-web-logs-dialog.js", () => ({
  openPortForLogs: mocks.openPortForLogs,
}));
vi.mock("../../src/util/web-serial.js", () => ({
  requestSerialPort: mocks.requestSerialPort,
}));
vi.mock("../../src/util/ble-nus-stream.js", () => ({
  BleUnavailableError: class BleUnavailableError extends Error {},
  bleUnavailableReason: mocks.bleUnavailableReason,
  isWebBluetoothSupported: mocks.isWebBluetoothSupported,
  requestBleNusDevice: mocks.requestBleNusDevice,
}));
vi.mock("../../src/web/install/esphome-web-install-nrf-dialog.js", () => ({}));
vi.mock("../../src/web/dashboard/esphome-web-card.js", () => ({}));
vi.mock("../../src/util/register-icons.js", () => ({ registerMdiIcons: vi.fn() }));
vi.mock("sonner-js", () => ({ default: { error: mocks.toastError } }));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/tooltip/tooltip.js", () => ({}));

import { expectTooltipsAnchored } from "../_tooltip-anchors.js";
import { BleUnavailableError } from "../../src/util/ble-nus-stream.js";
import { ESPHomeWebNrfCard } from "../../src/web/dashboard/esphome-web-nrf-card.js";

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
  mocks.isWebBluetoothSupported.mockReturnValue(true);
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
    expect(mocks.openPortForLogs).toHaveBeenCalledWith(port, expect.any(Function));
    expect(logsDialog(el).port).toBe(port);
    expect(logsDialog(el).bleDevice).toBeUndefined();
    expect(logsDialog(el).hasAttribute("open")).toBe(true);
    expect(logsDialog(el).noReset).toBe(true);
  });

  it("stays closed when the picker is dismissed or the port will not open", async () => {
    const el = await mount();
    mocks.requestSerialPort.mockResolvedValue(null);
    await (el as any)._showSerialLogs();
    expect((el as any)._logsOpen).toBe(false);
    mocks.requestSerialPort.mockResolvedValue({});
    mocks.openPortForLogs.mockResolvedValue(false);
    await (el as any)._showSerialLogs();
    expect((el as any)._logsOpen).toBe(false);
  });

  it("opens the logs dialog on the picked Bluetooth device", async () => {
    const el = await mount();
    const device = {};
    mocks.requestBleNusDevice.mockResolvedValue(device);
    await (el as any)._showBleLogs();
    await el.updateComplete;
    expect(mocks.requestBleNusDevice).toHaveBeenCalledWith([]);
    expect(logsDialog(el).bleDevice).toBe(device);
    expect(logsDialog(el).port).toBeUndefined();
    expect(logsDialog(el).hasAttribute("open")).toBe(true);
  });

  it("toasts when Bluetooth is missing, off, or the chooser fails", async () => {
    const el = await mount();
    mocks.isWebBluetoothSupported.mockReturnValue(false);
    await (el as any)._showBleLogs();
    expect(mocks.toastError).toHaveBeenLastCalledWith(
      "dashboard.logs_ble_nus_unsupported"
    );

    mocks.isWebBluetoothSupported.mockReturnValue(true);
    mocks.requestBleNusDevice.mockRejectedValue(new BleUnavailableError());
    mocks.bleUnavailableReason.mockResolvedValue("brave");
    await (el as any)._showBleLogs();
    expect(mocks.toastError).toHaveBeenLastCalledWith(
      "dashboard.logs_ble_nus_unavailable",
      {
        description: "dashboard.logs_method_ble_nus_brave",
      }
    );

    mocks.requestBleNusDevice.mockRejectedValue(new Error("boom"));
    await (el as any)._showBleLogs();
    expect(mocks.toastError).toHaveBeenLastCalledWith(
      "dashboard.logs_ble_nus_open_failed"
    );
    expect((el as any)._logsOpen).toBe(false);
  });

  it("forgets the source when the logs dialog hides", async () => {
    const el = await mount();
    mocks.requestBleNusDevice.mockResolvedValue({});
    await (el as any)._showBleLogs();
    (el as any)._onLogsHidden();
    await el.updateComplete;
    expect(logsDialog(el).hasAttribute("open")).toBe(false);
    expect(logsDialog(el).bleDevice).toBeUndefined();
  });
});
