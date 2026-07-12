import { describe, expect, it } from "vitest";
import { isCompilePhaseLine } from "../../src/util/compile-phase.js";

describe("isCompilePhaseLine", () => {
  it("matches the ESP-IDF / PlatformIO compile-phase lines", () => {
    for (const line of [
      "Compiling .pioenvs/apy/esp_hw_support/cpu.c.o",
      "Archiving .pioenvs/apy/esp-idf/esp_event/libesp_event.a",
      "Indexing .pioenvs/apy/esp-idf/esp_gdbstub/libesp_gdbstub.a",
      "Linking .pioenvs/apy/firmware.elf",
      "Building in release mode",
    ]) {
      expect(isCompilePhaseLine(line)).toBe(true);
    }
  });

  it("matches the bracketed Arduino / ninja progress forms", () => {
    expect(isCompilePhaseLine("[ 17%] Building CXX object")).toBe(true);
    expect(isCompilePhaseLine("[907/1424] Building C object")).toBe(true);
  });

  it("tolerates a leading ANSI colour reset", () => {
    expect(isCompilePhaseLine("\x1b[0mCompiling src/main.cpp.o")).toBe(true);
  });

  it("ignores the dependency-download and setup lines", () => {
    for (const line of [
      "Tool Manager: Installing file:///Users/bdraco/esphome/.esphome/build",
      "Library Manager: Installing esphome/noise-c @ 0.1.11",
      "Unpacking  [####################]  100%",
      "Library Manager: Resolving dependencies...",
      "HARDWARE: ESP32 240MHz, 320KB RAM, 4MB Flash",
      "- framework-espidf @ 3.50504.0 (5.5.4)",
      "Reading CMake configuration...",
    ]) {
      expect(isCompilePhaseLine(line)).toBe(false);
    }
  });
});
