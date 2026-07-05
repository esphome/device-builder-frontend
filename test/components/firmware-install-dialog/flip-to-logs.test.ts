/**
 * @vitest-environment happy-dom
 *
 * flipToLogs forwards the device's raw logger baud_rate into the post-install
 * handoff; the logs handler resolves it (0 disabled / null default).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { dispatchShowLogsAfterInstall } = vi.hoisted(() => ({
  dispatchShowLogsAfterInstall: vi.fn(
    (_source: HTMLElement, _detail: { loggerBaudRate?: number | null }) => true
  ),
}));
vi.mock("../../../src/util/post-install-logs.js", () => ({
  dispatchShowLogsAfterInstall,
}));

import type { ESPHomeFirmwareInstallDialog } from "../../../src/components/firmware-install-dialog.js";
import { flipToLogs } from "../../../src/components/firmware-install-dialog/install-flow.js";
import { identityLocalize } from "../../_dom.js";

function makeHost(loggerBaudRate: number | null): ESPHomeFirmwareInstallDialog {
  return {
    _device: {
      configuration: "x.yaml",
      name: "x",
      friendly_name: "X",
      logger_baud_rate: loggerBaudRate,
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
});
