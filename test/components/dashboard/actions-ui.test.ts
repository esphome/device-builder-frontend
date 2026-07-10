import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../../src/api/index.js";
import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import { DeviceState } from "../../../src/api/types/devices.js";
import type { LocalizeFunc } from "../../../src/common/localize.js";
import {
  executeRename,
  openLogsWithMethod,
} from "../../../src/components/dashboard/actions-ui.js";
import {
  confirmDialogCopy,
  executeConfirm,
  type PendingConfirm,
} from "../../../src/components/dashboard/render-dialogs.js";
import type { ESPHomePageDashboard } from "../../../src/pages/dashboard.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";
import { makeDashboardHost } from "./_host.js";

const { toastError, toastSuccess } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock("sonner-js", () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const { requestAndOpenSerialPort } = vi.hoisted(() => ({
  requestAndOpenSerialPort: vi.fn(),
}));
vi.mock("../../../src/util/post-install-logs.js", () => ({
  requestAndOpenSerialPort,
  attachSerialLogStream: vi.fn(),
  reconnectWebSerialLogs: vi.fn(),
}));

// Append the interpolation params so the assertion sees the surfaced
// reason; the stub has no access to the en.json template the real
// _localize would expand, so embedding params is what proves the
// handler forwarded the backend detail into the toast.
const localize = ((key: string, params?: Record<string, string>) =>
  params ? `${key} ${Object.values(params).join(" ")}` : key) as unknown as LocalizeFunc;

function makeHost(
  renameDevice: ESPHomeAPI["renameDevice"],
  state: DeviceState = DeviceState.ONLINE
): { host: ESPHomePageDashboard; openConfirm: ReturnType<typeof vi.fn> } {
  const openConfirm = vi.fn();
  const host = makeDashboardHost({
    _actionDevice: {
      name: "rename_test",
      friendly_name: "Rename_Test",
      configuration: "rename_test.yaml",
      state,
    } as ConfiguredDevice,
    _api: { renameDevice } as unknown as ESPHomeAPI,
    _localize: localize,
    _openConfirm: openConfirm,
  });
  return { host, openConfirm };
}

function renameEvent(newName: string): CustomEvent<string> {
  return new CustomEvent("rename-confirm", { detail: newName });
}

describe("openLogsWithMethod web-serial", () => {
  beforeEach(() => {
    toastError.mockClear();
    requestAndOpenSerialPort.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("blocks serial logs and notifies when logging is disabled (baud_rate 0)", async () => {
    vi.stubGlobal("navigator", { serial: {} });
    const host = makeDashboardHost();
    const device = {
      configuration: "x.yaml",
      name: "x",
      friendly_name: "X",
      logger_baud_rate: 0,
    } as ConfiguredDevice;

    await openLogsWithMethod(host, device, "web-serial");

    expect(toastError).toHaveBeenCalledWith(
      "dashboard.logs_serial_disabled",
      expect.anything()
    );
    expect(requestAndOpenSerialPort).not.toHaveBeenCalled();
  });
});

describe("executeRename", () => {
  beforeEach(() => toastError.mockClear());
  afterEach(() => vi.restoreAllMocks());

  it("renames an online device directly (no confirm, OTA path)", async () => {
    const renameDevice = vi.fn(async () => ({
      configuration: "rename-test.yaml",
      job: null,
    }));
    const { host, openConfirm } = makeHost(
      renameDevice as unknown as ESPHomeAPI["renameDevice"]
    );

    await executeRename(host, renameEvent("rename-test"));

    expect(openConfirm).not.toHaveBeenCalled();
    expect(renameDevice).toHaveBeenCalledWith("rename_test.yaml", "rename-test", false);
  });

  it("confirms before renaming an offline device, without calling the API", async () => {
    const renameDevice = vi.fn();
    const { host, openConfirm } = makeHost(
      renameDevice as unknown as ESPHomeAPI["renameDevice"],
      DeviceState.OFFLINE
    );

    await executeRename(host, renameEvent("rename-test"));

    expect(renameDevice).not.toHaveBeenCalled();
    expect(openConfirm).toHaveBeenCalledTimes(1);
    const pending = openConfirm.mock.calls[0][0] as PendingConfirm;
    expect(pending).toMatchObject({ kind: "rename-config-only", newName: "rename-test" });
  });

  it("confirms for an unknown-state device too (only online skips the prompt)", async () => {
    const renameDevice = vi.fn();
    const { host, openConfirm } = makeHost(
      renameDevice as unknown as ESPHomeAPI["renameDevice"],
      DeviceState.UNKNOWN
    );

    await executeRename(host, renameEvent("rename-test"));

    expect(renameDevice).not.toHaveBeenCalled();
    expect(openConfirm).toHaveBeenCalledTimes(1);
  });

  it("surfaces the backend reason in the rename-failure toast", async () => {
    const reason = "A device named rename-test.yaml already exists";
    const renameDevice = vi.fn(async () => {
      throw new Error(`invalid_args: ${reason}`);
    }) as unknown as ESPHomeAPI["renameDevice"];
    const { host } = makeHost(renameDevice);

    await executeRename(host, renameEvent("rename-test"));

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0][0]).toContain(reason);
  });
});

describe("executeConfirm rename-config-only", () => {
  afterEach(() => vi.restoreAllMocks());

  it("forwards config_only=true to the API on the confirmed offline path", async () => {
    const renameDevice = vi.fn(async () => ({
      configuration: "rename-test.yaml",
      job: null,
    }));
    const { host } = makeHost(
      renameDevice as unknown as ESPHomeAPI["renameDevice"],
      DeviceState.OFFLINE
    );
    const pending: PendingConfirm = {
      kind: "rename-config-only",
      device: host._actionDevice as ConfiguredDevice,
      newName: "rename-test",
    };

    executeConfirm(host, pending);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(renameDevice).toHaveBeenCalledWith("rename_test.yaml", "rename-test", true);
  });

  it("is destructive so a stray Enter can't confirm the offline rename", () => {
    const device = {
      name: "rename_test",
      friendly_name: "Rename_Test",
      configuration: "rename_test.yaml",
    } as ConfiguredDevice;
    const copy = confirmDialogCopy(
      { kind: "rename-config-only", device, newName: "rename-test" },
      localize,
      0,
      () => ({})
    );

    expect(copy.destructive).toBe(true);
  });
});

describe("clear-queued-update confirm", () => {
  function makeClearHost(
    firmwareClearQueuedUpdate: ESPHomeAPI["firmwareClearQueuedUpdate"]
  ): ESPHomePageDashboard {
    return makeDashboardHost({
      _api: { firmwareClearQueuedUpdate } as unknown as ESPHomeAPI,
      _localize: localize,
    });
  }

  it("is a non-destructive confirm naming the device", () => {
    const copy = confirmDialogCopy(
      { kind: "clear-queued-update", device: makeConfiguredDevice() },
      localize,
      0,
      () => ({})
    );

    expect(copy.heading).toBe("dashboard.queued_update_confirm_title");
    expect(copy.message).toContain("Kitchen");
    expect(copy.confirm).toBe("dashboard.action_clear_queued");
    expect(copy.destructive).toBe(false);
  });

  it("clears via the API and toasts success", async () => {
    const clear = vi.fn(async () => {});
    const host = makeClearHost(
      clear as unknown as ESPHomeAPI["firmwareClearQueuedUpdate"]
    );

    executeConfirm(host, {
      kind: "clear-queued-update",
      device: makeConfiguredDevice(),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(clear).toHaveBeenCalledWith("kitchen.yaml");
    expect(toastSuccess.mock.lastCall![0]).toContain("Kitchen");
  });

  it("surfaces the backend error in a toast on failure", async () => {
    const clear = vi.fn(async () => {
      throw new Error("flag already cleared");
    });
    const host = makeClearHost(
      clear as unknown as ESPHomeAPI["firmwareClearQueuedUpdate"]
    );

    executeConfirm(host, {
      kind: "clear-queued-update",
      device: makeConfiguredDevice(),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(toastError.mock.lastCall![0]).toContain("flag already cleared");
  });
});
