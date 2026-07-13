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
      // esp-idf: the real start after the download.
      "Reading CMake configuration...",
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
    expect(isCompilePhaseLine("[ 17%] Compiling .pio/build/uno/src/main.cpp.o")).toBe(
      true
    );
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

  it("starts on the first ninja counter, incl. the reconfigure re-check", () => {
    // Download precedes ninja, so the first counter is the build start — no
    // total floor. These used to be excluded; the clock now starts here.
    expect(isCompilePhaseLine("[0/2] Re-checking globbed directories...\x1b[K")).toBe(
      true
    );
    expect(isCompilePhaseLine("[1/2] Re-running CMake...")).toBe(true);
    expect(isCompilePhaseLine("[3/97] Performing build step for 'bootloader'")).toBe(
      true
    );
  });

  it("does not start on a stray download / flash / OTA percentage", () => {
    for (const line of [
      "Unpacking  [------------------------------------]    0%",
      "Writing at 0x00010000... (45 %)",
      "Writing at 0x000cf943 [=>  ]  84.8% 491520/579918 bytes...",
      "Uploading: [====      ] 35% ...",
      "RAM:   [====      ]  37.7% (used 30900 bytes from 81920 bytes)",
      "Flash: [====      ]  41.8% (used 428199 bytes from 1023984 bytes)",
      "Downloading toolchain (45%)",
    ]) {
      expect(isCompilePhaseLine(line)).toBe(false);
    }
  });

  it("tolerates a leading ANSI colour reset", () => {
    expect(isCompilePhaseLine("\x1b[0mCompiling src/main.cpp.o")).toBe(true);
  });

  it("ignores the dependency-download and setup narration lines", () => {
    for (const line of [
      "Tool Manager: Installing file:///Users/bdraco/esphome/.esphome/build",
      "Library Manager: Installing esphome/noise-c @ 0.1.11",
      "Unpacking  [####################]  100%",
      "Library Manager: Resolving dependencies...",
      "HARDWARE: ESP32 240MHz, 320KB RAM, 4MB Flash",
      "- framework-espidf @ 3.50504.0 (5.5.4)",
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

  it("matches the real ANSI-coloured banner (colours inside the brackets)", () => {
    // PlatformIO wraps SUCCESS/FAILED in colour codes between the brackets:
    // `[<green><bold>SUCCESS<reset>] Took`. Must still match once stripped.
    expect(
      isCompileEndLine(
        "\x1b[0m========================= [\x1b[32m\x1b[1mSUCCESS\x1b[0m] Took 14.73 seconds =========================\x1b[0m"
      )
    ).toBe(true);
    expect(isCompileEndLine("[\x1b[31m\x1b[1mFAILED\x1b[0m] Took 4.10 seconds")).toBe(
      true
    );
  });

  it("does not match ordinary build output", () => {
    expect(isCompileEndLine("Compiling .pio/build/esp32dev/src/main.cpp.o")).toBe(false);
    expect(isCompileEndLine("[117/1247] Building C object")).toBe(false);
  });
});
