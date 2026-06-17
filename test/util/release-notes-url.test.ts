import { describe, expect, it } from "vitest";
import {
  deviceBuilderReleaseUrl,
  esphomeChangelogUrl,
} from "../../src/util/release-notes-url.js";

describe("deviceBuilderReleaseUrl", () => {
  it("links a stable version to its release tag", () => {
    expect(deviceBuilderReleaseUrl("1.0.3")).toBe(
      "https://github.com/esphome/device-builder/releases/tag/1.0.3"
    );
    expect(deviceBuilderReleaseUrl("v1.0.3")).toBe(
      "https://github.com/esphome/device-builder/releases/tag/1.0.3"
    );
  });

  it("links a beta version to its release tag", () => {
    expect(deviceBuilderReleaseUrl("1.0.2b4")).toBe(
      "https://github.com/esphome/device-builder/releases/tag/1.0.2b4"
    );
  });

  it("returns null for a dev build", () => {
    expect(deviceBuilderReleaseUrl("0.0.0")).toBeNull();
    expect(deviceBuilderReleaseUrl("")).toBeNull();
    expect(deviceBuilderReleaseUrl("0.1.0.dev5+g1234")).toBeNull();
  });
});

describe("esphomeChangelogUrl", () => {
  it("links a stable version to its minor changelog page", () => {
    expect(esphomeChangelogUrl("2026.5.0")).toBe(
      "https://esphome.io/changelog/2026.5.0/"
    );
  });

  it("normalizes a patch version to the minor page", () => {
    expect(esphomeChangelogUrl("2026.5.3")).toBe(
      "https://esphome.io/changelog/2026.5.0/"
    );
  });

  it("routes a beta version to the beta docs site", () => {
    expect(esphomeChangelogUrl("2026.6.0b3")).toBe(
      "https://beta.esphome.io/changelog/2026.6.0/"
    );
    expect(esphomeChangelogUrl("2026.12.0b2")).toBe(
      "https://beta.esphome.io/changelog/2026.12.0/"
    );
  });

  it("links a dev build to the next docs root", () => {
    expect(esphomeChangelogUrl("2026.7.0-dev")).toBe("https://next.esphome.io/");
  });

  it("returns null for an unparseable version", () => {
    expect(esphomeChangelogUrl("")).toBeNull();
    expect(esphomeChangelogUrl("not-a-version")).toBeNull();
  });
});
