import { describe, expect, it } from "vitest";
import { isCompileEndLine, isCompilePhaseLine } from "../../src/util/compile-phase.js";

describe("isCompilePhaseLine", () => {
  it("matches the universal 'Compiling ' line on every PlatformIO toolchain", () => {
    for (const line of [
      // esp32 esp-idf (pio builder)
      "Compiling .pioenvs/apy/esp_hw_support/cpu.c.o",
      // esp32 platformio (arduino)
      "Compiling .pio/build/esp32dev/src/main.cpp.o",
      // esp8266
      "Compiling .pio/build/nodemcuv2/core/core_esp8266_main.cpp.o",
      // libretiny (bk72xx / rtl87xx)
      "Compiling .pio/build/bk72xx/src/main.cpp.o",
    ]) {
      expect(isCompilePhaseLine(line)).toBe(true);
    }
  });

  it("matches the other build-step lines a cached build may start with", () => {
    for (const line of [
      "Archiving .pioenvs/apy/esp-idf/esp_event/libesp_event.a",
      "Indexing .pioenvs/apy/esp-idf/esp_gdbstub/libesp_gdbstub.a",
      "Linking .pio/build/nodemcuv2/firmware.elf",
      "Generating partitions .pio/build/esp32dev/partitions.bin",
      "Building in release mode",
    ]) {
      expect(isCompilePhaseLine(line)).toBe(true);
    }
  });

  it("matches raw ninja build targets by their large denominator", () => {
    expect(isCompilePhaseLine("[117/1247] Building C object esp-idf/esp_wifi/…")).toBe(
      true
    );
    expect(
      isCompilePhaseLine("[7/1247] Generating ../../partition_table/partition-table.bin")
    ).toBe(true);
    expect(isCompilePhaseLine("[ 17%] Building CXX object")).toBe(true);
    // Real captured esp-idf ninja chunks (CR-split, trailing erase-to-eol).
    expect(
      isCompilePhaseLine("[1/1547] Generating project_elf_src_esp32s3.c\x1b[K")
    ).toBe(true);
    expect(
      isCompilePhaseLine(
        "[6/1547] Building C object esp-idf/esp_adc/CMakeFiles/__idf_esp_adc.dir/adc_cali.c.obj\x1b[K"
      )
    ).toBe(true);
  });

  it("ignores the ninja reconfigure / globbed-dir counters (small denominator)", () => {
    expect(isCompilePhaseLine("[1/2] Re-running CMake...")).toBe(false);
    expect(isCompilePhaseLine("[0/4] Re-checking globbed directories...\x1b[K")).toBe(
      false
    );
    expect(isCompilePhaseLine("[3/97] Performing build step for 'bootloader'")).toBe(
      false
    );
  });

  it("tolerates a leading ANSI colour reset", () => {
    expect(isCompilePhaseLine("\x1b[0mCompiling src/main.cpp.o")).toBe(true);
  });

  it("ignores the dependency-download and configure lines", () => {
    for (const line of [
      "Tool Manager: Installing file:///Users/bdraco/esphome/.esphome/build",
      "Library Manager: Installing esphome/noise-c @ 0.1.11",
      "Unpacking  [####################]  100%",
      "Library Manager: Resolving dependencies...",
      "HARDWARE: ESP32 240MHz, 320KB RAM, 4MB Flash",
      "- framework-espidf @ 3.50504.0 (5.5.4)",
      "Reading CMake configuration...",
      "-- Configuring done (3.0s)",
      "-- Building ESP-IDF components for target esp32s3",
      "Executing action: reconfigure",
      "Running ninja in directory /data/build/apollo-r-pro-1-eth-5938e0/build",
    ]) {
      expect(isCompilePhaseLine(line)).toBe(false);
    }
  });
});

describe("isCompileEndLine", () => {
  it("matches the PlatformIO success and failure banners", () => {
    expect(
      isCompileEndLine(
        "========================= [SUCCESS] Took 15.36 seconds ========================="
      )
    ).toBe(true);
    expect(
      isCompileEndLine(
        "========================= [FAILED] Took 4.10 seconds ========================="
      )
    ).toBe(true);
  });

  it("does not match ordinary build output", () => {
    expect(isCompileEndLine("Compiling .pio/build/esp32dev/src/main.cpp.o")).toBe(false);
    expect(isCompileEndLine("[117/1247] Building C object")).toBe(false);
  });
});
