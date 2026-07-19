/**
 * Stateless option rows for <esphome-install-method-dialog>, split out
 * to keep the dialog under the file-size cap. The dialog registers the
 * webawesome elements (wa-icon, wa-callout) these templates render.
 */
import { html, nothing, type TemplateResult } from "lit";
import { DeviceState } from "../api/types/devices.js";
import type { LocalizeFunc } from "../common/localize.js";
import type { DeploymentEnvironment } from "../util/environment.js";

export interface MethodRowContext {
  localize: LocalizeFunc;
  mode: "install" | "logs";
  deviceState: DeviceState;
  neverFlashed: boolean;
  onSelect: (method: string) => void;
}

/** Shared option-row template; a row without ``onClick`` renders disabled. */
export function renderMethodRow(opts: {
  icon: string;
  title: unknown;
  desc: unknown;
  onClick?: () => void;
}): TemplateResult {
  return html`
    <div class="option ${!opts.onClick ? "option--disabled" : ""}" @click=${opts.onClick}>
      <wa-icon library="mdi" name=${opts.icon}></wa-icon>
      <div class="info">
        <span class="title">${opts.title}</span>
        <span class="desc">${opts.desc}</span>
      </div>
    </div>
  `;
}

/**
 * Dialog-top callout ahead of the method list, install mode only: a
 * first-install USB notice for a never-flashed device (it can't receive
 * an OTA by itself), else the compile-now-install-on-wake notice for an
 * offline device.
 */
export function renderInstallNotice(
  ctx: MethodRowContext
): TemplateResult | typeof nothing {
  if (ctx.mode !== "install") return nothing;
  if (ctx.neverFlashed) {
    return html`
      <wa-callout class="method-notice" variant="brand">
        <wa-icon slot="icon" library="mdi" name="usb"></wa-icon>
        ${ctx.localize("dashboard.install_method_first_install_notice")}
      </wa-callout>
    `;
  }
  if (ctx.deviceState === DeviceState.OFFLINE) {
    return html`
      <wa-callout class="method-notice" variant="warning">
        <wa-icon slot="icon" library="mdi" name="wifi"></wa-icon>
        ${ctx.localize("dashboard.install_method_offline_notice")}
      </wa-callout>
    `;
  }
  return nothing;
}

export function renderOtaOption(ctx: MethodRowContext): TemplateResult {
  // Install mode keeps the row clickable when not online; the
  // compile runs even if the upload fails. Logs mode has no
  // compile-equivalent so it stays gated on isOnline.
  const isOnline = ctx.deviceState === DeviceState.ONLINE;
  const enabled = isOnline || ctx.mode === "install";
  const titleKey =
    ctx.mode === "logs"
      ? "dashboard.logs_method_wireless"
      : "dashboard.install_method_network";
  let descKey: string;
  if (ctx.mode === "logs") {
    descKey = "dashboard.logs_method_wireless_desc";
  } else if (ctx.neverFlashed) {
    // Before the OFFLINE branch: never-flashed devices usually sit in
    // UNKNOWN, so the offline copy alone would not fire for them.
    descKey = "dashboard.install_method_network_desc_never_flashed";
  } else if (ctx.deviceState === DeviceState.OFFLINE) {
    descKey = "dashboard.install_method_network_desc_offline";
  } else {
    descKey = "dashboard.install_method_network_desc";
  }
  return renderMethodRow({
    icon: "wifi",
    title: ctx.localize(titleKey),
    desc: ctx.localize(descKey),
    onClick: enabled ? () => ctx.onSelect("ota") : undefined,
  });
}

/**
 * Server-serial row, worded for where the backend is running. On HA the
 * user is plugging into their HA server; on a local backend without
 * WebSerial they're plugging into their own machine; remote setups use
 * the generic phrasing.
 */
export function renderServerSerialOption(
  localize: LocalizeFunc,
  env: DeploymentEnvironment,
  onClick: () => void
): TemplateResult {
  const keys = serverSerialCopyKeys(env);
  return renderMethodRow({
    icon: "serial-port",
    title: localize(keys.title),
    desc: localize(keys.desc),
    onClick,
  });
}

/**
 * Manual binary download — always offered in install mode. Compiles
 * here, hands the user the resulting binary, and leaves flashing to
 * whatever tool they prefer (esptool.py, picotool, copy-to-MSC for
 * UF2 platforms, etc). Distinct from the USB row, which flashes for the
 * user (in-app or via the external flasher) and is gated to ESP32 / ESP8266.
 */
export function renderManualDownloadOption(ctx: MethodRowContext): TemplateResult {
  return renderMethodRow({
    icon: "download",
    title: ctx.localize("dashboard.install_method_manual_download"),
    desc: ctx.localize("dashboard.install_method_manual_download_desc"),
    onClick: () => ctx.onSelect("binary-download"),
  });
}

/**
 * OTA bootloader update — flashes the second-stage bootloader instead
 * of the app (the "Bootloader too old for OTA rollback" warning's fix
 * without a USB cable). Rendered only when the host says the device
 * can accept it and it's online for the flash to land.
 */
export function renderBootloaderOption(ctx: MethodRowContext): TemplateResult {
  return renderMethodRow({
    icon: "chip",
    title: ctx.localize("dashboard.install_method_bootloader"),
    desc: ctx.localize("dashboard.install_method_bootloader_desc"),
    onClick: () => ctx.onSelect("bootloader"),
  });
}

function serverSerialCopyKeys(env: DeploymentEnvironment): {
  title: string;
  desc: string;
} {
  switch (env) {
    case "ha-addon":
      return {
        title: "dashboard.install_method_usb_server_ha",
        desc: "dashboard.install_method_usb_server_ha_desc",
      };
    case "localhost":
      return {
        title: "dashboard.install_method_usb_server_localhost",
        desc: "dashboard.install_method_usb_server_localhost_desc",
      };
    case "remote":
    default:
      return {
        title: "dashboard.install_method_usb_server",
        desc: "dashboard.install_method_usb_server_desc",
      };
  }
}
