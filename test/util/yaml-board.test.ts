import { describe, expect, it } from "vitest";
import type { SlimBoard } from "../../src/api/types/boards.js";
import { boardDisagreesWithYaml, readPlatformBoard } from "../../src/util/yaml-board.js";
import { makeSlimBoard } from "../_make-slim-board.js";

const slimBoard = (esphome: Partial<SlimBoard["esphome"]>): SlimBoard =>
  makeSlimBoard("esp32dev", esphome);

describe("readPlatformBoard", () => {
  it("reads board and variant from an esp32 section", () => {
    const yaml =
      "esphome:\n  name: dev\nesp32:\n  board: esp32-s3-devkitc-1\n  variant: ESP32S3\n";
    expect(readPlatformBoard(yaml)).toEqual({
      platform: "esp32",
      board: "esp32-s3-devkitc-1",
      variant: "ESP32S3",
    });
  });

  it("reads an esp8266 section with no variant", () => {
    const yaml = "esp8266:\n  board: d1_mini\n";
    expect(readPlatformBoard(yaml)).toEqual({
      platform: "esp8266",
      board: "d1_mini",
      variant: null,
    });
  });

  it("folds the rp2 alias onto rp2040", () => {
    const yaml = "rp2:\n  board: rpipicow\n";
    expect(readPlatformBoard(yaml)).toEqual({
      platform: "rp2040",
      board: "rpipicow",
      variant: null,
    });
  });

  it("peels quotes and inline comments off the scalar", () => {
    const yaml = 'esp32:\n  board: "esp32-c3-devkitm-1"  # was s3\n';
    expect(readPlatformBoard(yaml)?.board).toBe("esp32-c3-devkitm-1");
  });

  it("does not misread keys nested under a framework block", () => {
    const yaml =
      "esp32:\n  framework:\n    type: esp-idf\n    board: bogus\n  board: esp32dev\n";
    expect(readPlatformBoard(yaml)?.board).toBe("esp32dev");
  });

  it("returns null without a platform section", () => {
    const yaml = "esphome:\n  name: dev\npackages:\n  base: !include base.yaml\n";
    expect(readPlatformBoard(yaml)).toBeNull();
  });

  it("returns a null board for a bare platform section", () => {
    const yaml = "esp32:\n  variant: ESP32C3\n";
    expect(readPlatformBoard(yaml)).toEqual({
      platform: "esp32",
      board: null,
      variant: "ESP32C3",
    });
  });
});

describe("boardDisagreesWithYaml", () => {
  it("flags a different PlatformIO board string", () => {
    const parsed = readPlatformBoard("esp32:\n  board: esp32-c3-devkitm-1\n")!;
    expect(
      boardDisagreesWithYaml(parsed, slimBoard({ board: "esp32-s3-devkitc-1" }))
    ).toBe(true);
  });

  it("flags a different platform", () => {
    const parsed = readPlatformBoard("esp8266:\n  board: d1_mini\n")!;
    expect(boardDisagreesWithYaml(parsed, slimBoard({ platform: "esp32" }))).toBe(true);
  });

  it("flags an explicit variant mismatch case-insensitively", () => {
    const parsed = readPlatformBoard("esp32:\n  board: esp32dev\n  variant: ESP32C3\n")!;
    expect(
      boardDisagreesWithYaml(parsed, slimBoard({ board: "esp32dev", variant: "esp32s3" }))
    ).toBe(true);
  });

  it("normalizes variant spellings before comparing", () => {
    const parsed = readPlatformBoard(
      "esp32:\n  board: esp32-s3-devkitc-1\n  variant: ESP32S3\n"
    )!;
    expect(
      boardDisagreesWithYaml(
        parsed,
        slimBoard({ board: "esp32-s3-devkitc-1", variant: "esp32s3" })
      )
    ).toBe(false);
  });

  it("never flags a curated pick sharing the same PlatformIO string", () => {
    const parsed = readPlatformBoard("esp32:\n  board: esp32-c6-devkitm-1\n")!;
    expect(
      boardDisagreesWithYaml(
        parsed,
        slimBoard({ board: "ESP32-C6-DevKitM-1", variant: "esp32c6" })
      )
    ).toBe(false);
  });

  it("does not flag on the variant axis when the YAML has none", () => {
    const parsed = readPlatformBoard("esp32:\n  board: esp32dev\n")!;
    expect(
      boardDisagreesWithYaml(parsed, slimBoard({ board: "esp32dev", variant: "esp32" }))
    ).toBe(false);
  });
});
