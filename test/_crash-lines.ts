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

// Captured from a c3test abort: the esp32 crash handler stores two unwound
// frames, then walks the stack for anything that looks like a return
// address. Both real frames are panic machinery, and BT3's round address
// decodes to an mdns symbol the crash never entered.
export const CRASH_BLOCK_STACK_SCAN = [
  "[E][esp32.crash:332]: *** CRASH DETECTED ON PREVIOUS BOOT ***",
  "[E][esp32.crash:335]:   Reason: Fault - Illegal instruction",
  "WARNING Decoded 0x40384f10: panic_abort at /COMPONENT_ESP_SYSTEM_DIR/panic.c:491",
  "[E][esp32.crash:305]:   BT0: 0x40384F10  (backtrace)",
  "WARNING Decoded 0x40384f10: panic_abort at /COMPONENT_ESP_SYSTEM_DIR/panic.c:491",
  "[E][esp32.crash:305]:   BT1: 0x40384ED4  (backtrace)",
  "WARNING Decoded 0x40384ed4: esp_vApplicationTickHook at /COMPONENT_ESP_SYSTEM_DIR/freertos_hooks.c:31",
  "[E][esp32.crash:305]:   BT2: 0x40388AF2  (stack scan)",
  "WARNING Decoded 0x40388af2: __assert_func at /COMPONENT_NEWLIB_DIR/src/assert.c:34",
  "[E][esp32.crash:305]:   BT3: 0x42020000  (stack scan)",
  "WARNING Decoded 0x42020000: mdns_priv_browse_result_add_ip at /IDF_BUILD/../managed_components/espressif__mdns/mdns_browser.c:352",
  "[E][esp32.crash:305]:   BT4: 0x4200DF4C  (stack scan)",
  "WARNING Decoded 0x4200df4c: esphome::preferences::IntervalSyncer::on_shutdown() at /IDF_BUILD/../src/esphome/components/preferences/syncer.h:18",
  "Rebooting...",
];

// The same handler on a store-access fault, where the unwound frames do
// carry a nameable one: BT0 is the user's own lambda trampoline, BT1 the
// esphome action that invoked it.
export const CRASH_BLOCK_UNWOUND = [
  "[E][esp32.crash:332]: *** CRASH DETECTED ON PREVIOUS BOOT ***",
  "[E][esp32.crash:335]:   Reason: Fault - Store access fault",
  "WARNING Decoded 0x4200deee: setup()::{lambda()#1}::_FUN() at /IDF_BUILD/configs/c3test.yaml:39",
  " (inlined by) _FUN at /IDF_BUILD/configs/c3test.yaml:40",
  "[E][esp32.crash:305]:   BT0: 0x4200DEEE  (backtrace)",
  "WARNING Decoded 0x4200deee: setup()::{lambda()#1}::_FUN() at /IDF_BUILD/configs/c3test.yaml:39",
  "[E][esp32.crash:305]:   BT1: 0x4200DF18  (backtrace)",
  "WARNING Decoded 0x4200df18: esphome::Action<>::play_next_() at /IDF_BUILD/../src/esphome/core/automation.h:519",
  "[E][esp32.crash:305]:   BT2: 0x42018552  (stack scan)",
  "WARNING Decoded 0x42018552: esphome::button::Button::press() at /IDF_BUILD/../src/esphome/components/button/button.cpp:21",
  "Rebooting...",
];

// The same recursion under a task watchdog: identical unwound frames to
// CRASH_BLOCK_UNWOUND, so only the handler's reason tells the two apart.
export const CRASH_BLOCK_TASK_WDT = [
  "[E][esp32.crash:332]: *** CRASH DETECTED ON PREVIOUS BOOT ***",
  "[E][esp32.crash:335]:   Reason: Task wdt",
  "WARNING Decoded 0x4200def8: setup()::{lambda()#3}::_FUN() at /IDF_BUILD/configs/c3test.yaml:52",
  "[E][esp32.crash:305]:   BT0: 0x4200DEF8  (backtrace)",
  "[E][esp32.crash:305]:   BT1: 0x4200DF18  (backtrace)",
  "WARNING Decoded 0x4200df18: esphome::Action<>::play_next_() at /IDF_BUILD/../src/esphome/core/automation.h:519",
  "[E][esp32.crash:305]:   BT2: 0x4208C45E  (stack scan)",
  "WARNING Decoded 0x4208c45e: xQueueGenericSend at /COMPONENT_FREERTOS_DIR/FreeRTOS-Kernel/queue.c:966",
  "Rebooting...",
];

// Recursion deep enough that the scan re-finds an address the unwinder
// already vouched for: 0x4200DF18 is labelled both ways.
export const CRASH_BLOCK_REPEATED_ADDRESS = [
  "[E][esp32.crash:332]: *** CRASH DETECTED ON PREVIOUS BOOT ***",
  "[E][esp32.crash:335]:   Reason: Task wdt",
  "[E][esp32.crash:305]:   BT0: 0x4200DF18  (backtrace)",
  "WARNING Decoded 0x4200df18: esphome::api::APIServer::loop() at api_server.cpp:180",
  "[E][esp32.crash:305]:   BT1: 0x4200DF18  (stack scan)",
  "WARNING Decoded 0x4200df18: esphome::api::APIServer::loop() at api_server.cpp:180",
  "Rebooting...",
];

// A device's editor YAML with an inline credential, and the same YAML
// after `maskSensitiveYaml`.
export const RAW_CONFIG_YAML =
  "esphome:\n  name: smallgarage\nwifi:\n  ssid: mynetwork\n  password: hunter2";

export const MASKED_CONFIG_YAML =
  "esphome:\n  name: smallgarage\nwifi:\n  ssid: mynetwork\n  password: •";
