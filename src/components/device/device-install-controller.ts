import { type ReactiveController, type ReactiveControllerHost } from "lit";
import { type ConfiguredDevice, DeviceState } from "../../api/types/devices.js";
import { canFlashBootloader } from "../../util/bootloader-flash.js";
import { applyInstallMethod } from "../apply-install-method.js";
import type { CommandType, ESPHomeCommandDialog } from "../command-dialog.js";
import type { ESPHomeFirmwareInstallDialog } from "../firmware-install-dialog.js";

export interface DeviceInstallControllerHost extends ReactiveControllerHost {
  /** Currently displayed device, or null when not yet loaded. */
  readonly device: ConfiguredDevice | null;
  /** Resolve the mounted command-dialog instance. */
  readonly commandDialog: ESPHomeCommandDialog | null;
  /** Resolve the mounted firmware-install-dialog instance. */
  readonly firmwareDialog: ESPHomeFirmwareInstallDialog | null;
}

export class DeviceInstallController implements ReactiveController {
  private _host: DeviceInstallControllerHost;
  installMethodOpen = false;

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

  /** "Install" entry point — opens the install-method picker. */
  onInstall = () => {
    if (!this._host.device) return;
    this.installMethodOpen = true;
    this._host.requestUpdate();
  };

  /** "Update" entry point — bypasses the picker, runs install via OTA/server. */
  onUpdate = () => {
    const device = this._host.device;
    if (!device) return;
    this._openCommand(device, "install");
  };

  onInstallMethodClose = () => {
    this.installMethodOpen = false;
    this._host.requestUpdate();
  };

  onInstallMethodSelect = (e: CustomEvent<{ method: string; port?: string }>) => {
    const device = this._host.device;
    this.installMethodOpen = false;
    this._host.requestUpdate();
    if (!device) return;
    const { method, port } = e.detail;
    applyInstallMethod(method, port, {
      device,
      firmwareDialog: this._host.firmwareDialog,
      openInstall: (p, options) => this._openCommand(device, "install", p, options),
    });
  };

  private _openCommand(
    device: ConfiguredDevice,
    type: CommandType,
    port?: string,
    options?: { bootloader?: boolean }
  ) {
    this._host.commandDialog?.openForDevice(device, type, { port, ...options });
  }
}
