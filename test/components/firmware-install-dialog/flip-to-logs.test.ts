/**
 * @vitest-environment happy-dom
 *
 * flipToLogs forwards the device's raw logger baud_rate into the post-install
 * handoff; the logs handler resolves it (0 disabled / null default).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { dispatchShowLogsAfterInstall } = vi.hoisted(() => ({
  dispatchShowLogsAfterInstall: vi.fn(
    (
      _source: HTMLElement,
      _detail: {
        loggerBaudRate?: number | null;
        loggerInterface?: string | null;
        notice?: string;
      }
    ) => true
  ),
}));
vi.mock("../../../src/util/post-install-dispatch.js", () => ({
  dispatchShowLogsAfterInstall,
}));

import { identityLocalize } from "../../_dom.js";
import type { ESPHomeFirmwareInstallDialog } from "../../../src/components/firmware-install-dialog.js";
import {
  finishWithLogsPort,
  flipToLogs,
} from "../../../src/components/firmware-install-dialog/install-flow.js";

function makeHost(
  loggerBaudRate: number | null,
  loggerInterface: string | null = null
): ESPHomeFirmwareInstallDialog {
  return {
    _device: {
      configuration: "x.yaml",
      name: "x",
      friendly_name: "X",
      logger_baud_rate: loggerBaudRate,
      logger_interface: loggerInterface,
    },
    _localize: identityLocalize,
    _open: true,
    reopen: vi.fn(),
  } as unknown as ESPHomeFirmwareInstallDialog;
}

const port = {} as SerialPort;

describe("flipToLogs", () => {
  afterEach(() => vi.clearAllMocks());

  it.each([19200, 0, null])("forwards the raw logger baud %s", (baud) => {
    flipToLogs(makeHost(baud), port);
    expect(dispatchShowLogsAfterInstall).toHaveBeenCalledTimes(1);
    expect(dispatchShowLogsAfterInstall.mock.calls[0][1].loggerBaudRate).toBe(baud);
  });

  it.each(["USB_SERIAL_JTAG", null])("forwards the logger interface %s", (iface) => {
    flipToLogs(makeHost(115200, iface), port);
    expect(dispatchShowLogsAfterInstall).toHaveBeenCalledTimes(1);
    expect(dispatchShowLogsAfterInstall.mock.calls[0][1].loggerInterface).toBe(iface);
  });

  it("carries the install's notice to the logs, also from the Done step's button", () => {
    const host = makeHost(115200);
    Object.assign(host, { _showLogsAfterInstall: true });
    finishWithLogsPort(host, port, { notice: "Reset the board" });
    flipToLogs(host, port);
    expect(dispatchShowLogsAfterInstall).toHaveBeenCalledTimes(2);
    for (const [, detail] of dispatchShowLogsAfterInstall.mock.calls) {
      expect(detail.notice).toBe("Reset the board");
    }
  });

  it("sends no notice by default", () => {
    flipToLogs(makeHost(115200), port);
    expect(dispatchShowLogsAfterInstall.mock.calls[0][1].notice).toBeUndefined();
  });
});
