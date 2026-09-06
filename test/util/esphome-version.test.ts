/**
 * Pins the ordered esphome version comparator and the two OTA-encryption
 * gates built on it: released 2026.9.0+ firmware offers, and the
 * dashboard's own esphome must accept the block.
 */
import { describe, expect, it } from "vitest";

import {
  compareEsphomeVersions,
  firmwareOffersOtaEncryption,
  isReleaseVersion,
  toolchainAcceptsOtaEncryption,
} from "../../src/util/esphome-version.js";

describe("compareEsphomeVersions", () => {
  it.each([
    ["2026.9.0", "2026.9.0", 0],
    ["2026.9", "2026.9.0", 0],
    ["2026.9.1", "2026.9.0", 1],
    ["2026.8.3", "2026.9.0", -1],
    ["2026.10.0", "2026.9.0", 1],
    ["2027.1.0", "2026.12.0", 1],
    ["2026.9.0b1", "2026.9.0", -1],
    ["2026.9.0b2", "2026.9.0b1", 1],
    ["2026.9.0rc1", "2026.9.0b3", 1],
    ["2026.9.0rc1", "2026.9.0", -1],
    ["2026.9.0-dev", "2026.9.0", -1],
    ["2026.9.0.dev0", "2026.9.0b1", -1],
    ["2026.10.0-dev", "2026.9.0", 1],
    ["2026.9.0+abc", "2026.9.0", 0],
  ] as const)("%s vs %s is %d", (a, b, expected) => {
    expect(compareEsphomeVersions(a, b)).toBe(expected);
  });

  it("returns null for anything that is not a version", () => {
    expect(compareEsphomeVersions("", "2026.9.0")).toBeNull();
    expect(compareEsphomeVersions("2026.9.0", "unknown")).toBeNull();
  });
});

describe("isReleaseVersion", () => {
  it("accepts plain dotted numerals only", () => {
    expect(isReleaseVersion("2026.9.0")).toBe(true);
    expect(isReleaseVersion("2026.9")).toBe(true);
    expect(isReleaseVersion("2026.9.0b1")).toBe(false);
    expect(isReleaseVersion("2026.9.0-dev")).toBe(false);
    expect(isReleaseVersion("")).toBe(false);
  });
});

describe("firmwareOffersOtaEncryption", () => {
  it("needs a released 2026.9.0 or newer", () => {
    expect(firmwareOffersOtaEncryption("2026.9.0")).toBe(true);
    expect(firmwareOffersOtaEncryption("2026.9.2")).toBe(true);
    expect(firmwareOffersOtaEncryption("2027.1.0")).toBe(true);
    expect(firmwareOffersOtaEncryption("2026.8.3")).toBe(false);
    expect(firmwareOffersOtaEncryption("2026.9.0b1")).toBe(false);
    expect(firmwareOffersOtaEncryption("2026.10.0b1")).toBe(false);
    expect(firmwareOffersOtaEncryption("2026.10.0-dev")).toBe(false);
    expect(firmwareOffersOtaEncryption("")).toBe(false);
  });
});

describe("toolchainAcceptsOtaEncryption", () => {
  it("accepts 2026.9.0 and later, dev builds of later lines included", () => {
    expect(toolchainAcceptsOtaEncryption("2026.9.0")).toBe(true);
    expect(toolchainAcceptsOtaEncryption("2026.10.0-dev")).toBe(true);
    expect(toolchainAcceptsOtaEncryption("2026.9.0b2")).toBe(false);
    expect(toolchainAcceptsOtaEncryption("2026.8.0")).toBe(false);
    expect(toolchainAcceptsOtaEncryption("")).toBe(false);
  });
});
