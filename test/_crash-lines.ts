/** Shared crash-log fixtures for the crash-report suites. */

export const CRASH_BANNER_LINE =
  "Guru Meditation Error: Core  1 panic'ed (LoadProhibited). Exception was unhandled.";

// A realistic backend-streamed crash: panic banner, register dump,
// backtrace, esphome logs' inline decode, and the reboot terminator.
export const CRASH_BLOCK = [
  CRASH_BANNER_LINE,
  "Core  1 register dump:",
  "PC      : 0x400d9150  PS      : 0x00060330  A0      : 0x800da73c",
  "Backtrace: 0x400d9150:0x3ffb4f60 0x400da73c:0x3ffb4f90",
  "WARNING Decoded 0x400d9150: esphome::Application::setup() at esphome/core/application.cpp:59",
  "WARNING Decoded 0x400da73c: esphome::wifi::WiFiComponent::loop() at esphome/components/wifi/wifi_component.cpp:100",
  "Rebooting...",
];

// A `devices/validate` stream (esphome config output): CLI log records
// interleaved with the sanitized YAML, and the YAML it distills to.
export const VALIDATE_OUTPUT = [
  "\\033[32mINFO ESPHome 2026.6.4\\033[0m",
  "\\033[32mINFO Reading configuration smallgarage.yaml...\\033[0m",
  "esphome:",
  "  name: smallgarage",
  "wifi:",
  "  password: <removed>",
  "\\033[32mINFO Configuration is valid!\\033[0m",
];

export const VALIDATED_CONFIG_YAML =
  "esphome:\n  name: smallgarage\nwifi:\n  password: <removed>";
