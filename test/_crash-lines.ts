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
