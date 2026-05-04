import { type ReactiveController, type ReactiveControllerHost } from "lit";
import { DeviceState, type ConfiguredDevice } from "../../api/types.js";
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
    return this._host.device?.state ?? DeviceState.UNKNOWN;
  }

  get deviceTargetPlatform(): string {
    return this._host.device?.target_platform ?? "";
  }

  get deviceCurrentAddress(): string {
    return this._host.device?.ip || this._host.device?.address || "";
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
    if (method === "ota") {
      // ``port`` is set when the user typed an explicit address
      // into the OTA option's chevron-expanded form — pass it
      // through so the CLI flashes against that override. The
      // literal "OTA" sentinel is the default-address path.
      this._openCommand(device, "install", port ?? "OTA");
    } else if (method === "server-serial") {
      this._openCommand(device, "install", port!);
    } else if (method === "web-serial") {
      this._host.firmwareDialog?.installWebSerial(device);
    } else if (method === "web-download") {
      this._host.firmwareDialog?.installWebDownload(device);
    } else if (method === "binary-download") {
      this._host.firmwareDialog?.installBinaryDownload(device);
    }
  };

  private _openCommand(device: ConfiguredDevice, type: CommandType, port?: string) {
    const dialog = this._host.commandDialog;
    if (!dialog) return;
    dialog.configuration = device.configuration;
    dialog.name = device.friendly_name || device.name;
    dialog.open(type, port ? { port } : undefined);
  }
}
