import {
  mdiApi,
  mdiBellOutline,
  mdiBluetooth,
  mdiCalendarClock,
  mdiCameraOutline,
  mdiCardTextOutline,
  mdiCheckboxMarkedCircleOutline,
  mdiChip,
  mdiClockOutline,
  mdiCloudUploadOutline,
  mdiConnection,
  mdiExportVariant,
  mdiFan,
  mdiFormDropdown,
  mdiFormTextbox,
  mdiGauge,
  mdiGestureTapButton,
  mdiLan,
  mdiLightbulbOutline,
  mdiLockOutline,
  mdiMonitor,
  mdiNumeric,
  mdiSerialPort,
  mdiShapeOutline,
  mdiShieldHomeOutline,
  mdiSpeaker,
  mdiTextBoxOutline,
  mdiThermostat,
  mdiToggleSwitchOutline,
  mdiValve,
  mdiWeb,
  mdiWifi,
  mdiWifiLock,
  mdiWindowShutter,
} from "@mdi/js";
import { registerMdiIcons } from "../../util/register-icons.js";

/**
 * Per-domain leading glyph for navigator rows, so a long Core or
 * Components list can be scanned by shape. Keyed on the YAML domain
 * (``item.key``); the value is ``[registered mdi name, svg path]`` so
 * registration derives from this one map and shared glyphs dedupe.
 */
const DOMAIN_ICON: Record<string, readonly [string, string]> = {
  // Core infrastructure
  esphome: ["chip", mdiChip],
  wifi: ["wifi", mdiWifi],
  ethernet: ["lan", mdiLan],
  mdns: ["lan", mdiLan],
  api: ["api", mdiApi],
  ota: ["cloud-upload-outline", mdiCloudUploadOutline],
  logger: ["card-text-outline", mdiCardTextOutline],
  web_server: ["web", mdiWeb],
  captive_portal: ["wifi-lock", mdiWifiLock],
  time: ["clock-outline", mdiClockOutline],
  sntp: ["clock-outline", mdiClockOutline],
  uart: ["serial-port", mdiSerialPort],
  i2c: ["connection", mdiConnection],
  spi: ["connection", mdiConnection],
  esp32_ble: ["bluetooth", mdiBluetooth],
  esp32_ble_tracker: ["bluetooth", mdiBluetooth],
  ble: ["bluetooth", mdiBluetooth],

  // Component platforms
  sensor: ["gauge", mdiGauge],
  binary_sensor: ["checkbox-marked-circle-outline", mdiCheckboxMarkedCircleOutline],
  text_sensor: ["text-box-outline", mdiTextBoxOutline],
  switch: ["toggle-switch-outline", mdiToggleSwitchOutline],
  light: ["lightbulb-outline", mdiLightbulbOutline],
  output: ["export-variant", mdiExportVariant],
  number: ["numeric", mdiNumeric],
  select: ["form-dropdown", mdiFormDropdown],
  button: ["gesture-tap-button", mdiGestureTapButton],
  fan: ["fan", mdiFan],
  cover: ["window-shutter", mdiWindowShutter],
  climate: ["thermostat", mdiThermostat],
  text: ["form-textbox", mdiFormTextbox],
  lock: ["lock-outline", mdiLockOutline],
  valve: ["valve", mdiValve],
  media_player: ["speaker", mdiSpeaker],
  display: ["monitor", mdiMonitor],
  datetime: ["calendar-clock", mdiCalendarClock],
  camera: ["camera-outline", mdiCameraOutline],
  event: ["bell-outline", mdiBellOutline],
  alarm_control_panel: ["shield-home-outline", mdiShieldHomeOutline],
};

/** Neutral glyph for any domain not in {@link DOMAIN_ICON}. */
const FALLBACK: readonly [string, string] = ["shape-outline", mdiShapeOutline];

registerMdiIcons(Object.fromEntries([...Object.values(DOMAIN_ICON), FALLBACK]));

/** Registered mdi icon name for a row's domain; neutral shape if unmapped. */
export function iconForDomain(domain: string): string {
  return (DOMAIN_ICON[domain] ?? FALLBACK)[0];
}
