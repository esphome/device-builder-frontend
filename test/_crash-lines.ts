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

// The same crash as captured over Web Serial: identical but for the inline
// decode, which only `esphome logs` produces. This is what the backend
// decoder exists to fill in.
export const CRASH_BLOCK_UNDECODED = CRASH_BLOCK.filter(
  (line) => !line.startsWith("WARNING Decoded ")
);

// An esp8266 crash as stored and replayed at boot. Its decoder emits bare
// symbols with no ` at file:line`, so the frame parse can't rely on one.
export const CRASH_BLOCK_ESP8266 = [
  "[E][esp8266:171]: *** CRASH DETECTED ON PREVIOUS BOOT ***",
  "[E][esp8266:172]: BT0: 0x4025349f",
  "WARNING Decoded 0x40100739: __wrap_system_restart_local",
  "WARNING Decoded 0x4025349f: cnx_node_search",
  "WARNING Decoded 0x40225716: loop_task(ETSEventTag*) at core_esp8266_main.cpp",
  "Rebooting...",
];

// A crash whose every frame is panic or idle machinery: real reports look
// like this whenever the fault lands in a parked core.
export const CRASH_BLOCK_NOISE_ONLY = [
  CRASH_BANNER_LINE,
  "Backtrace: 0x4037989a:0x3ffb4f60 0x4037989a:0x3ffb4f90",
  "WARNING Decoded 0x4037989a: esp_cpu_wait_for_intr at /COMPONENT_ESP_HW_SUPPORT_DIR/cpu.c:64",
  "WARNING Decoded 0x4037989a: esp_cpu_wait_for_intr at /COMPONENT_ESP_HW_SUPPORT_DIR/cpu.c:64",
  "WARNING Decoded 0x4037984a: xt_utils_wait_for_intr at /COMPONENT_XTENSA_DIR/include/xt_utils.h:82",
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
