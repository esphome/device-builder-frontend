/**
 * @vitest-environment happy-dom
 *
 * flipToLogs threads the device's resolved log baud into the post-install
 * handoff, and skips the serial log view (notifying instead) when logging is
 * disabled (logger baud_rate 0), where the port would be silent.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { dispatchShowLogsAfterInstall } = vi.hoisted(() => ({
  dispatchShowLogsAfterInstall: vi.fn(
    (_source: HTMLElement, _detail: { loggerBaudRate?: number }) => true
  ),
}));
vi.mock("../../../src/util/post-install-logs.js", () => ({
  dispatchShowLogsAfterInstall,
}));

const { toastInfo } = vi.hoisted(() => ({ toastInfo: vi.fn() }));
vi.mock("sonner-js", () => ({ default: { info: toastInfo } }));

import type { ESPHomeFirmwareInstallDialog } from "../../../src/components/firmware-install-dialog.js";
import { flipToLogs } from "../../../src/components/firmware-install-dialog/install-flow.js";

function makeHost(loggerBaudRate: number | null): ESPHomeFirmwareInstallDialog {
  return {
    _device: {
      configuration: "x.yaml",
      name: "x",
      friendly_name: "X",
      logger_baud_rate: loggerBaudRate,
    },
    _localize: (key: string) => key,
    _open: true,
    reopen: vi.fn(),
  } as unknown as ESPHomeFirmwareInstallDialog;
}

const port = {} as SerialPort;

describe("flipToLogs", () => {
  afterEach(() => vi.clearAllMocks());

  it("hands off with the device's resolved log baud", () => {
    flipToLogs(makeHost(19200), port);
    expect(dispatchShowLogsAfterInstall).toHaveBeenCalledTimes(1);
    expect(dispatchShowLogsAfterInstall.mock.calls[0][1].loggerBaudRate).toBe(19200);
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it("notifies and skips the serial log view when logging is disabled (baud 0)", () => {
    flipToLogs(makeHost(0), port);
    expect(toastInfo).toHaveBeenCalledWith(
      "dashboard.logs_serial_disabled",
      expect.anything()
    );
    expect(dispatchShowLogsAfterInstall).not.toHaveBeenCalled();
  });
});
