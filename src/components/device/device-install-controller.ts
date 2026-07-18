import { type ReactiveController, type ReactiveControllerHost } from "lit";
import type { ESPHomeAPI } from "../../api/index.js";
import { type ConfiguredDevice, DeviceState } from "../../api/types/devices.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { canFlashBootloader } from "../../util/bootloader-flash.js";
import { isNeverFlashed } from "../../util/never-flashed.js";
import {
  launchLogs,
  launchLogsWithMethod,
  type LogsLaunchHost,
} from "../../util/logs-launch.js";
import { applyInstallMethod } from "../apply-install-method.js";
import type { CommandType, ESPHomeCommandDialog } from "../command-dialog.js";
import type { ESPHomeFirmwareInstallDialog } from "../firmware-install-dialog.js";
import type { ESPHomeLogsDialog } from "../logs-dialog.js";

export interface DeviceInstallControllerHost extends ReactiveControllerHost {
  /** Currently displayed device, or null when not yet loaded. */
  readonly device: ConfiguredDevice | null;
  /** Resolve the mounted command-dialog instance. */
  readonly commandDialog: ESPHomeCommandDialog | null;
  /** Resolve the mounted firmware-install-dialog instance. */
  readonly firmwareDialog: ESPHomeFirmwareInstallDialog | null;
  /** Resolve the mounted logs-dialog instance. */
  readonly logsDialog: ESPHomeLogsDialog | null;
  readonly api: ESPHomeAPI;
  readonly localize: LocalizeFunc;
  /** Re-attach the command dialog to the device's running job; true when one existed. */
  openActiveJobProgress(): boolean;
}

export class DeviceInstallController implements ReactiveController {
  private _host: DeviceInstallControllerHost;
  installMethodOpen = false;
  /** Which action the shared method picker is serving; drives its `.mode` so
   *  Logs shows the logs title/rows, not install. */
  methodMode: "install" | "logs" = "install";

  constructor(host: DeviceInstallControllerHost) {
    this._host = host;
    host.addController(this);
  }

  hostConnected() {
    /* no-op */
  }

  get deviceState(): DeviceState {
    return this._host.device?.runtime_state.state ?? DeviceState.UNKNOWN;
  }

  get deviceTargetPlatform(): string {
    return this._host.device?.target_platform ?? "";
  }

  get deviceCurrentAddress(): string {
    return this._host.device?.ip || this._host.device?.address || "";
  }

  get canFlashBootloader(): boolean {
    return canFlashBootloader(this._host.device);
  }

  get neverFlashed(): boolean {
    return isNeverFlashed(this._host.device);
  }

  /** "Install" entry point — opens the install-method picker. */
  onInstall = () => {
    if (!this._host.device) return;
    if (this._host.openActiveJobProgress()) return;
    this.methodMode = "install";
    this.installMethodOpen = true;
    this._host.requestUpdate();
  };

  /** "Logs" entry point — picker in logs mode when a serial path exists, else OTA logs. */
  onLogs = () => {
    const device = this._host.device;
    const logsDialog = this._host.logsDialog;
    if (!device || !logsDialog) return;
    void launchLogs(this._logsHost(logsDialog), device, () => {
      this.methodMode = "logs";
      this.installMethodOpen = true;
      this._host.requestUpdate();
    });
  };

  /** "Update" entry point — bypasses the picker, runs install via OTA/server. */
  onUpdate = () => {
    const device = this._host.device;
    if (!device) return;
    this._openCommand(device, "install");
  };

  onInstallMethodClose = () => {
    this.installMethodOpen = false;
    this.methodMode = "install";
    this._host.requestUpdate();
  };

  onInstallMethodSelect = (e: CustomEvent<{ method: string; port?: string }>) => {
    const device = this._host.device;
    const mode = this.methodMode;
    this.installMethodOpen = false;
    this.methodMode = "install";
    this._host.requestUpdate();
    if (!device) return;
    const { method, port } = e.detail;
    if (mode === "logs") {
      const logsDialog = this._host.logsDialog;
      if (!logsDialog) return;
      void launchLogsWithMethod(this._logsHost(logsDialog), device, method, port);
      return;
    }
    // A job may have started while the picker sat open; enqueuing now
    // would supersede it. Covers the firmwareDialog methods too, which
    // never reach _openCommand's guard.
    if (this._host.openActiveJobProgress()) return;
    applyInstallMethod(method, port, {
      device,
      firmwareDialog: this._host.firmwareDialog,
      openInstall: (p, options) => this._openCommand(device, "install", p, options),
    });
  };

  private _logsHost(logsDialog: ESPHomeLogsDialog): LogsLaunchHost {
    return { api: this._host.api, logsDialog, localize: this._host.localize };
  }

  private _openCommand(
    device: ConfiguredDevice,
    type: CommandType,
    port?: string,
    options?: { bootloader?: boolean }
  ) {
    // Mirrors the dashboard's openCommand: an install enqueued over a
    // running job would supersede it (cancel + restart).
    if (type === "install" && this._host.openActiveJobProgress()) return;
    this._host.commandDialog?.openForDevice(device, type, { port, ...options });
  }
}
