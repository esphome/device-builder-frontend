/**
 * @vitest-environment happy-dom
 *
 * A new platform's logs policy needs no edits in the shared logs code: with a
 * test-only platform added to the registry, the logs picker rows, the line
 * release on open, its Reset Device and the Bluetooth pick and connect
 * all follow its descriptor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../_mock-webawesome.js";

vi.mock("@home-assistant/webawesome/dist/components/callout/callout.js", () => ({}));
vi.mock("../../src/util/copy-to-clipboard.js", () => ({
  copyToClipboard: vi.fn(async () => true),
}));
vi.mock("sonner-js", () => ({
  default: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const fake = vi.hoisted(() => ({
  platform: undefined as
    import("../../src/platforms/platform-support.js").PlatformSupport | undefined,
}));
vi.mock("../../src/platforms/registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/platforms/registry.js")>();
  return {
    ...actual,
    platformFor: (targetPlatform: string | null | undefined) =>
      targetPlatform === "test-only" ? fake.platform : actual.platformFor(targetPlatform),
  };
});

import { withWebSerial } from "../_web-serial.js";
import type { ConfiguredDevice } from "../../src/api/types/devices.js";
import { DeviceState } from "../../src/api/types/devices.js";
import { defaultLocalize } from "../../src/common/localize.js";
import { ESPHomeInstallMethodDialog } from "../../src/components/install-method-dialog.js";
import type { ESPHomeLogsDialog } from "../../src/components/logs-dialog.js";
import type { PlatformSupport } from "../../src/platforms/platform-support.js";
import {
  launchLogs,
  launchLogsWithMethod,
  type LogsLaunchHost,
} from "../../src/util/logs-launch.js";
import { openPortForLogs, sessionResetHook } from "../../src/util/post-install-logs.js";
import {
  restoreWebSerialEnv,
  setLocalhostWithWebSerial,
} from "../components/_install-method-dialog-env.js";

const bleDevice = {} as BluetoothDevice;
const bleCancel = async () => {};
const platform = {
  id: "test-only",
  matches: (p: string | null | undefined) => p === "test-only",
  logs: {
    serial: {
      pulseResets: false,
      releasesLinesAfterOpen: true,
      reset: {
        available: () => true,
        supports: () => true,
        reset: vi.fn(async (_port: SerialPort, _baud: number, _c: () => boolean) => null),
        failureKey: () => "dashboard.logs_reset_failed",
      },
    },
    ble: {
      available: () => true,
      pick: vi.fn(async () => bleDevice),
      connect: vi.fn(async () => bleCancel),
      failureKey: () => "dashboard.logs_ble_nus_open_failed",
    },
  },
} satisfies PlatformSupport;
fake.platform = platform;

const device = {
  name: "thing",
  friendly_name: "Thing",
  configuration: "thing.yaml",
  target_platform: "test-only",
} as ConfiguredDevice;

function logsHost() {
  return {
    api: { getSerialPorts: vi.fn(async () => []) },
    logsDialog: {
      open: vi.fn(),
      openPassive: vi.fn(() => () => false),
      setBleStream: vi.fn(),
      setSerialOpenFailed: vi.fn(),
    },
    localize: defaultLocalize,
  };
}

beforeEach(() => {
  setLocalhostWithWebSerial();
});

afterEach(() => {
  restoreWebSerialEnv();
  vi.clearAllMocks();
});

describe("a platform added only to the registry", () => {
  it("gets the Web Serial logs row and drops server-serial on localhost", async () => {
    const dialog = new ESPHomeInstallMethodDialog();
    Object.assign(dialog, { _localize: defaultLocalize, _api: {} });
    dialog.deviceState = DeviceState.ONLINE;
    dialog.deviceTargetPlatform = "test-only";
    dialog.mode = "logs";
    dialog.open = true;
    document.body.appendChild(dialog);
    await dialog.updateComplete;
    const root = dialog.shadowRoot!;
    expect(root.querySelector('wa-icon[name="usb"]')).not.toBeNull();
    expect(root.querySelector('wa-icon[name="serial-port"]')).toBeNull();
    dialog.remove();
  });

  it("releases DTR and RTS after opening a logs port", async () => {
    const port = {
      open: vi.fn(async () => {}),
      setSignals: vi.fn(async () => {}),
    } as unknown as SerialPort;
    await openPortForLogs(port, 115200, "test-only");
    expect(port.setSignals).toHaveBeenCalledWith({
      dataTerminalReady: false,
      requestToSend: false,
    });
  });

  it("runs its own Reset Device at the session's baud", async () => {
    const dialog = { setSerialOpenFailed: vi.fn() } as unknown as ESPHomeLogsDialog;
    const hook = sessionResetHook(dialog, defaultLocalize, "test-only", 9600)!;
    const port = { getInfo: () => ({}) } as SerialPort;
    expect(hook.supports(port)).toBe(true);
    await hook.run(port, () => false);
    expect(platform.logs.serial.reset.reset).toHaveBeenCalledWith(
      port,
      9600,
      expect.any(Function)
    );
    // It never came back: the session fails, naming the port.
    expect(dialog.setSerialOpenFailed).toHaveBeenCalled();
  });

  it("offers the logs picker for its Bluetooth logs", async () => {
    const restore = withWebSerial(false);
    try {
      const host = logsHost();
      const openPicker = vi.fn();
      await launchLogs(host as unknown as LogsLaunchHost, device, openPicker);
      expect(openPicker).toHaveBeenCalledOnce();
    } finally {
      restore();
    }
  });

  it("picks and connects its Bluetooth logs through the descriptor", async () => {
    const host = logsHost();
    await launchLogsWithMethod(host as unknown as LogsLaunchHost, device, "ble-nus");
    expect(platform.logs.ble.pick).toHaveBeenCalledWith(defaultLocalize, [
      "thing",
      "Thing",
    ]);
    expect(platform.logs.ble.connect).toHaveBeenCalledWith(
      bleDevice,
      expect.objectContaining({ onLine: expect.any(Function) }),
      expect.any(Function)
    );
    expect(host.logsDialog.setBleStream).toHaveBeenCalledWith(bleCancel);
  });
});
