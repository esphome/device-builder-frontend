import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeConfiguredDevice } from "../../_make-configured-device.js";
import type { ESPHomeAPI } from "../../../src/api/index.js";
import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import { DeviceState } from "../../../src/api/types/devices.js";
import type { LocalizeFunc } from "../../../src/common/localize.js";
import {
  adoptFollowUp,
  executeClone,
  executeRename,
  openLogsWithMethod,
} from "../../../src/components/dashboard/actions-ui.js";
import {
  confirmDialogCopy,
  executeConfirm,
  type PendingConfirm,
} from "../../../src/components/dashboard/render-dialogs.js";
import type { RenameConfirmDetail } from "../../../src/components/rename-device-dialog.js";
import type { ESPHomePageDashboard } from "../../../src/pages/dashboard.js";
import { makeDashboardHost } from "./_host.js";

const { toastError, toastSuccess, toastInfo } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastInfo: vi.fn(),
}));
vi.mock("sonner-js", () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    info: (...args: unknown[]) => toastInfo(...args),
  },
}));

const { requestSerialPort } = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
}));
vi.mock("../../../src/util/post-install-logs.js", async (importOriginal) => ({
  // Keep the real openNetworkLogsFallback so the baud-0 reroute test can
  // assert its toast + dialog-open behavior through the real helper.
  ...(await importOriginal<object>()),
  attachSerialLogStream: vi.fn(),
  reconnectWebSerialLogs: vi.fn(),
}));
vi.mock("../../../src/util/web-serial.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestSerialPort,
}));

// Append the interpolation params so the assertion sees the surfaced
// reason; the stub has no access to the en.json template the real
// _localize would expand, so embedding params is what proves the
// handler forwarded the backend detail into the toast.
const localize = ((key: string, params?: Record<string, string>) =>
  params ? `${key} ${Object.values(params).join(" ")}` : key) as unknown as LocalizeFunc;

const okRename = () =>
  vi.fn(async () => ({ configuration: "rename-test.yaml", job: null }));
const okFriendly = () =>
  vi.fn(async () => ({ configuration: "rename_test.yaml", rewritten: true }));

function makeHost({
  state = DeviceState.ONLINE,
  otaSigned = false,
  renameDevice = okRename(),
  editFriendlyName = okFriendly(),
}: {
  state?: DeviceState;
  otaSigned?: boolean;
  renameDevice?: ReturnType<typeof vi.fn>;
  editFriendlyName?: ReturnType<typeof vi.fn>;
} = {}) {
  const openConfirm = vi.fn();
  const openInstallMethod = vi.fn();
  const host = makeDashboardHost({
    _actionDevice: makeConfiguredDevice({
      name: "rename_test",
      friendly_name: "Rename_Test",
      configuration: "rename_test.yaml",
      runtime_state: { state, ota_signed: otaSigned },
    }),
    _api: { renameDevice, editFriendlyName } as unknown as ESPHomeAPI,
    _localize: localize,
    _openConfirm: openConfirm,
    _openInstallMethod: openInstallMethod,
  });
  return { host, openConfirm, openInstallMethod, renameDevice, editFriendlyName };
}

function renameEvent(detail: RenameConfirmDetail): CustomEvent<RenameConfirmDetail> {
  return new CustomEvent("rename-confirm", { detail });
}

describe("openLogsWithMethod web-serial", () => {
  beforeEach(() => {
    toastError.mockClear();
    toastInfo.mockClear();
    requestSerialPort.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reroutes to network logs without a port picker when logging is disabled (baud_rate 0)", async () => {
    vi.stubGlobal("navigator", { serial: {} });
    const logsDialog = { configuration: "", name: "", open: vi.fn() };
    const host = makeDashboardHost({ _logsDialog: logsDialog });
    const device = {
      configuration: "x.yaml",
      name: "x",
      friendly_name: "X",
      logger_baud_rate: 0,
    } as ConfiguredDevice;

    await openLogsWithMethod(host, device, "web-serial");

    expect(toastInfo).toHaveBeenCalledWith(
      "dashboard.logs_serial_disabled_fallback",
      expect.anything()
    );
    expect(toastError).not.toHaveBeenCalled();
    expect(logsDialog.open).toHaveBeenCalledWith("OTA", {});
    expect(logsDialog.configuration).toBe("x.yaml");
    expect(requestSerialPort).not.toHaveBeenCalled();
  });

  it("reroutes a mismatched port to network logs without ever opening it", async () => {
    vi.stubGlobal("navigator", { serial: {} });
    const open = vi.fn(async () => {});
    requestSerialPort.mockResolvedValue({
      getInfo: () => ({ usbVendorId: 0x1a86 }),
      open,
    });
    const logsDialog = {
      configuration: "",
      name: "",
      open: vi.fn(),
      openPassive: vi.fn(),
    };
    const host = makeDashboardHost({ _logsDialog: logsDialog });
    const device = {
      configuration: "x.yaml",
      name: "x",
      friendly_name: "X",
      logger_baud_rate: null,
      logger_interface: "USB_SERIAL_JTAG",
    } as ConfiguredDevice;

    await openLogsWithMethod(host, device, "web-serial");

    // Never opened: no DTR/RTS pulse reaches a provably-silent port.
    expect(open).not.toHaveBeenCalled();
    expect(toastInfo).toHaveBeenCalledWith(
      expect.stringContaining("dashboard.logs_serial_wrong_port_fallback"),
      expect.anything()
    );
    expect(logsDialog.open).toHaveBeenCalledWith("OTA", {});
    expect(logsDialog.openPassive).not.toHaveBeenCalled();
  });

  it("opens a matching port and starts the serial session", async () => {
    vi.stubGlobal("navigator", { serial: {} });
    const open = vi.fn(async () => {});
    requestSerialPort.mockResolvedValue({
      getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
      open,
    });
    const logsDialog = {
      configuration: "",
      name: "",
      open: vi.fn(),
      openPassive: vi.fn(),
    };
    const host = makeDashboardHost({ _logsDialog: logsDialog });
    const device = {
      configuration: "x.yaml",
      name: "x",
      friendly_name: "X",
      logger_baud_rate: null,
      logger_interface: "USB_SERIAL_JTAG",
    } as ConfiguredDevice;

    await openLogsWithMethod(host, device, "web-serial");

    expect(open).toHaveBeenCalledWith({ baudRate: 115200 });
    expect(logsDialog.openPassive).toHaveBeenCalledTimes(1);
    expect(logsDialog.open).not.toHaveBeenCalled();
    expect(toastInfo).not.toHaveBeenCalled();
  });
});

describe("adoptFollowUp", () => {
  function makeAdoptHost(renameDevice: ESPHomeAPI["renameDevice"]) {
    const highlight = vi.fn();
    const followJob = vi.fn();
    const host = makeDashboardHost({
      _api: { renameDevice } as unknown as ESPHomeAPI,
      _localize: localize,
      _highlightFreshDevice: highlight,
      _commandDialog: { followJob },
      _devices: [],
    });
    return { host, highlight, followJob };
  }

  it("starts an OTA rename against the imported configuration for an edited name", async () => {
    const renameDevice = vi.fn(async () => ({
      configuration: "kitchen.yaml",
      job: { job_id: "j1", job_type: "compile" },
      tail_job: { job_id: "j2", job_type: "rename" },
    })) as unknown as ESPHomeAPI["renameDevice"];
    const { host, highlight, followJob } = makeAdoptHost(renameDevice);

    await adoptFollowUp(host, {
      name: "foo-1234",
      configuration: "foo-1234.yaml",
      friendlyName: "Foo",
      renameTo: "kitchen",
    });

    expect(highlight).toHaveBeenCalledWith("foo-1234.yaml");
    expect(renameDevice).toHaveBeenCalledWith("foo-1234.yaml", "kitchen", {
      configOnly: undefined,
      newFriendlyName: undefined,
    });
    expect(followJob).toHaveBeenCalledTimes(1);
  });

  it("starts no rename when the name was unedited", async () => {
    const renameDevice = vi.fn() as unknown as ESPHomeAPI["renameDevice"];
    const { host, highlight } = makeAdoptHost(renameDevice);

    await adoptFollowUp(host, {
      name: "foo-1234",
      configuration: "foo-1234.yaml",
      friendlyName: "Foo",
      renameTo: null,
    });

    expect(highlight).toHaveBeenCalledWith("foo-1234.yaml");
    expect(renameDevice).not.toHaveBeenCalled();
  });
});

describe("executeRename", () => {
  beforeEach(() => toastError.mockClear());
  afterEach(() => vi.restoreAllMocks());

  it("renames an online device directly (no confirm, OTA path)", async () => {
    const { host, openConfirm, renameDevice } = makeHost();

    await executeRename(host, renameEvent({ newName: "rename-test", install: true }));

    expect(openConfirm).not.toHaveBeenCalled();
    expect(renameDevice).toHaveBeenCalledWith("rename_test.yaml", "rename-test", {
      configOnly: false,
      newFriendlyName: undefined,
    });
  });

  it("confirms before renaming an offline device, without calling the API", async () => {
    const { host, openConfirm, renameDevice } = makeHost({ state: DeviceState.OFFLINE });

    await executeRename(host, renameEvent({ newName: "rename-test", install: true }));

    expect(renameDevice).not.toHaveBeenCalled();
    expect(openConfirm).toHaveBeenCalledTimes(1);
    const pending = openConfirm.mock.calls[0][0] as PendingConfirm;
    expect(pending).toMatchObject({
      kind: "rename-config-only",
      request: { newName: "rename-test" },
    });
  });

  it("confirms for an online device that rejects unsigned OTA images", async () => {
    const { host, openConfirm, renameDevice } = makeHost({ otaSigned: true });

    await executeRename(host, renameEvent({ newName: "rename-test", install: true }));

    expect(renameDevice).not.toHaveBeenCalled();
    const pending = openConfirm.mock.calls[0][0] as PendingConfirm;
    expect(pending).toMatchObject({
      kind: "rename-config-only",
      request: { newName: "rename-test" },
    });
  });

  it("confirms for an unknown-state device too (only online skips the prompt)", async () => {
    const { host, openConfirm, renameDevice } = makeHost({ state: DeviceState.UNKNOWN });

    await executeRename(host, renameEvent({ newName: "rename-test", install: true }));

    expect(renameDevice).not.toHaveBeenCalled();
    expect(openConfirm).toHaveBeenCalledTimes(1);
  });

  it("surfaces the backend reason in the rename-failure toast", async () => {
    const reason = "A device named rename-test.yaml already exists";
    const { host } = makeHost({
      renameDevice: vi.fn(async () => {
        throw new Error(`invalid_args: ${reason}`);
      }),
    });

    await executeRename(host, renameEvent({ newName: "rename-test", install: true }));

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0][0]).toContain(reason);
  });

  it("sends both names in one rename call when both changed", async () => {
    const { host, openConfirm, renameDevice } = makeHost();

    await executeRename(
      host,
      renameEvent({
        newName: "rename-test",
        newFriendlyName: "Rename Test",
        install: true,
      })
    );

    expect(openConfirm).not.toHaveBeenCalled();
    expect(renameDevice).toHaveBeenCalledWith("rename_test.yaml", "rename-test", {
      configOnly: false,
      newFriendlyName: "Rename Test",
    });
  });

  it("carries the friendly name into the offline confirm", async () => {
    const { host, openConfirm, renameDevice } = makeHost({ state: DeviceState.OFFLINE });

    await executeRename(
      host,
      renameEvent({
        newName: "rename-test",
        newFriendlyName: "Rename Test",
        install: true,
      })
    );

    expect(renameDevice).not.toHaveBeenCalled();
    const pending = openConfirm.mock.calls[0][0] as PendingConfirm;
    expect(pending).toMatchObject({
      kind: "rename-config-only",
      request: { newName: "rename-test", newFriendlyName: "Rename Test" },
    });
  });

  it("renames config-only without a confirm when install is unticked", async () => {
    const { host, openConfirm, renameDevice } = makeHost({ state: DeviceState.OFFLINE });

    await executeRename(
      host,
      renameEvent({
        newName: "rename-test",
        newFriendlyName: "Rename Test",
        install: false,
      })
    );

    expect(openConfirm).not.toHaveBeenCalled();
    expect(renameDevice).toHaveBeenCalledWith("rename_test.yaml", "rename-test", {
      configOnly: true,
      newFriendlyName: "Rename Test",
    });
  });

  it("edits the friendly name alone and opens the install picker", async () => {
    const { host, openConfirm, openInstallMethod, renameDevice, editFriendlyName } =
      makeHost({
        state: DeviceState.OFFLINE,
      });

    await executeRename(
      host,
      renameEvent({ newFriendlyName: "Rename Test", install: true })
    );

    expect(renameDevice).not.toHaveBeenCalled();
    expect(openConfirm).not.toHaveBeenCalled();
    expect(editFriendlyName).toHaveBeenCalledWith("rename_test.yaml", "Rename Test");
    expect(openInstallMethod).toHaveBeenCalledWith(host._actionDevice);
  });

  it("skips the install picker for a friendly-name-only edit with install unticked", async () => {
    const { host, openInstallMethod, editFriendlyName } = makeHost();

    await executeRename(
      host,
      renameEvent({ newFriendlyName: "Rename Test", install: false })
    );

    expect(editFriendlyName).toHaveBeenCalledTimes(1);
    expect(openInstallMethod).not.toHaveBeenCalled();
  });

  it("skips the install picker when the backend reports the friendly name unchanged", async () => {
    const { host, openInstallMethod } = makeHost({
      editFriendlyName: vi.fn(async () => ({
        configuration: "rename_test.yaml",
        rewritten: false,
      })),
    });

    await executeRename(
      host,
      renameEvent({ newFriendlyName: "Rename_Test", install: true })
    );

    expect(openInstallMethod).not.toHaveBeenCalled();
  });
});

describe("executeClone", () => {
  beforeEach(() => {
    toastError.mockClear();
    toastSuccess.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  function makeCloneHost(cloneDevice: ESPHomeAPI["cloneDevice"]): {
    host: ESPHomePageDashboard;
    onCloned: ReturnType<typeof vi.fn>;
  } {
    const onCloned = vi.fn();
    const host = makeDashboardHost({
      _actionDevice: makeConfiguredDevice({
        name: "kitchen",
        configuration: "kitchen.yaml",
      }),
      _api: { cloneDevice } as unknown as ESPHomeAPI,
      _localize: localize,
      _onCloned: onCloned,
    });
    return { host, onCloned };
  }

  function cloneEvent(
    newName: string,
    newFriendlyName = ""
  ): CustomEvent<{ newName: string; newFriendlyName: string }> {
    return new CustomEvent("clone-confirm", { detail: { newName, newFriendlyName } });
  }

  it("reveals the fresh clone on success (empty friendly name maps to undefined)", async () => {
    const cloneDevice = vi.fn(async () => ({ configuration: "bedroom-bulb.yaml" }));
    const { host, onCloned } = makeCloneHost(
      cloneDevice as unknown as ESPHomeAPI["cloneDevice"]
    );

    await executeClone(host, cloneEvent("bedroom-bulb"));

    expect(cloneDevice).toHaveBeenCalledWith("kitchen.yaml", "bedroom-bulb", undefined);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(onCloned).toHaveBeenCalledExactlyOnceWith("bedroom-bulb.yaml");
  });

  it("forwards a non-empty friendly name", async () => {
    const cloneDevice = vi.fn(async () => ({ configuration: "bedroom-bulb.yaml" }));
    const { host } = makeCloneHost(cloneDevice as unknown as ESPHomeAPI["cloneDevice"]);

    await executeClone(host, cloneEvent("bedroom-bulb", "Bedroom Bulb"));

    expect(cloneDevice).toHaveBeenCalledWith(
      "kitchen.yaml",
      "bedroom-bulb",
      "Bedroom Bulb"
    );
  });

  it("keeps the list untouched on failure and surfaces the reason", async () => {
    const reason = "A device named bedroom-bulb.yaml already exists";
    const cloneDevice = vi.fn(async () => {
      throw new Error(`invalid_args: ${reason}`);
    }) as unknown as ESPHomeAPI["cloneDevice"];
    const { host, onCloned } = makeCloneHost(cloneDevice);

    await executeClone(host, cloneEvent("bedroom-bulb"));

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0][0]).toContain(reason);
    expect(onCloned).not.toHaveBeenCalled();
  });
});

describe("executeConfirm rename-config-only", () => {
  afterEach(() => vi.restoreAllMocks());

  const request = (host: ESPHomePageDashboard, newFriendlyName?: string) => ({
    configuration: "rename_test.yaml",
    currentName: (host._actionDevice as ConfiguredDevice).name,
    newName: "rename-test",
    newFriendlyName,
  });

  it("forwards config_only=true to the API on the confirmed offline path", async () => {
    const { host, renameDevice } = makeHost({ state: DeviceState.OFFLINE });
    const pending: PendingConfirm = {
      kind: "rename-config-only",
      device: host._actionDevice as ConfiguredDevice,
      request: request(host),
    };

    executeConfirm(host, pending);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(renameDevice).toHaveBeenCalledWith("rename_test.yaml", "rename-test", {
      configOnly: true,
      newFriendlyName: undefined,
    });
  });

  it("forwards the friendly name alongside config_only on the confirmed path", async () => {
    const { host, renameDevice } = makeHost({ state: DeviceState.OFFLINE });
    const pending: PendingConfirm = {
      kind: "rename-config-only",
      device: host._actionDevice as ConfiguredDevice,
      request: request(host, "Rename Test"),
    };

    executeConfirm(host, pending);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(renameDevice).toHaveBeenCalledWith("rename_test.yaml", "rename-test", {
      configOnly: true,
      newFriendlyName: "Rename Test",
    });
  });

  it("is destructive so a stray Enter can't confirm the offline rename", () => {
    const device = makeConfiguredDevice({
      name: "rename_test",
      friendly_name: "Rename_Test",
      configuration: "rename_test.yaml",
    });
    const copy = confirmDialogCopy(
      {
        kind: "rename-config-only",
        device,
        request: {
          configuration: "rename_test.yaml",
          currentName: "rename_test",
          newName: "x",
        },
      },
      localize,
      0,
      () => ({})
    );

    expect(copy.destructive).toBe(true);
  });

  it("explains the USB install for a device that rejects unsigned OTA images", () => {
    const device = makeConfiguredDevice({ runtime_state: { ota_signed: true } });
    const copy = confirmDialogCopy(
      {
        kind: "rename-config-only",
        device,
        request: {
          configuration: device.configuration,
          currentName: device.name,
          newName: "x",
        },
      },
      localize,
      0,
      () => ({})
    );

    expect(copy.heading).toBe("dashboard.action_rename_ota_signed_title");
    expect(copy.message).toContain("dashboard.action_rename_ota_signed_desc");
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
