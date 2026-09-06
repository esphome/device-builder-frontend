/**
 * Pins the esphome version ordering and the two OTA-encryption
 * gates built on it: released 2026.9.0+ firmware offers, and the
 * dashboard's own esphome must accept the block.
 */
import { describe, expect, it } from "vitest";

import {
  firmwareOffersOtaEncryption,
  isReleaseVersion,
  toolchainAcceptsOtaEncryption,
  versionAtLeast,
} from "../../src/util/esphome-version.js";

describe("versionAtLeast", () => {
  it.each([
    ["2026.9.0", "2026.9.0", true],
    ["2026.9", "2026.9.0", true],
    ["2026.9.1", "2026.9.0", true],
    ["2026.8.3", "2026.9.0", false],
    ["2026.10.0", "2026.9.0", true],
    ["2027.1.0", "2026.12.0", true],
    ["2026.9.0b1", "2026.9.0", false],
    ["2026.9.0rc1", "2026.9.0", false],
    ["2026.9.0-dev", "2026.9.0", false],
    ["2026.10.0-dev", "2026.9.0", true],
    ["2026.10.0b1", "2026.9.0", true],
  ] as const)("%s at least %s is %s", (a, b, expected) => {
    expect(versionAtLeast(a, b)).toBe(expected);
  });

  it("is false when either side is not a version", () => {
    expect(versionAtLeast("", "2026.9.0")).toBe(false);
    expect(versionAtLeast("2026.9.0", "unknown")).toBe(false);
  });
});

describe("isReleaseVersion", () => {
  it("accepts the YYYY.M[.P] release shape only", () => {
    expect(isReleaseVersion("2026.9.0")).toBe(true);
    expect(isReleaseVersion("2026.9")).toBe(true);
    expect(isReleaseVersion("2026")).toBe(false);
    expect(isReleaseVersion("2026.9.0.1")).toBe(false);
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
  it("accepts the 2026.9 line and later, prereleases included", () => {
    expect(toolchainAcceptsOtaEncryption("2026.9.0")).toBe(true);
    expect(toolchainAcceptsOtaEncryption("2026.9.0b2")).toBe(true);
    expect(toolchainAcceptsOtaEncryption("2026.9.0-dev")).toBe(true);
    expect(toolchainAcceptsOtaEncryption("2026.10.0-dev")).toBe(true);
    expect(toolchainAcceptsOtaEncryption("2026.8.0")).toBe(false);
    expect(toolchainAcceptsOtaEncryption("2026.8.3b1")).toBe(false);
    expect(toolchainAcceptsOtaEncryption("")).toBe(false);
  });
});
