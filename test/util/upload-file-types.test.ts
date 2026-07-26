import { describe, expect, it } from "vitest";

import {
  ACCEPTED_UPLOAD_EXTENSIONS,
  FILE_INPUT_ACCEPT,
  isBundleFilename,
} from "../../src/util/upload-file-types.js";

describe("isBundleFilename", () => {
  it("recognizes bundle archives regardless of case", () => {
    expect(isBundleFilename("device.esphomebundle.tar.gz")).toBe(true);
    expect(isBundleFilename("DEVICE.TAR.GZ")).toBe(true);
    expect(isBundleFilename("device.tgz")).toBe(true);
    expect(isBundleFilename("device.esphomebundle")).toBe(true);
  });

  it("treats plain YAML as not-a-bundle", () => {
    expect(isBundleFilename("device.yaml")).toBe(false);
    expect(isBundleFilename("device.yml")).toBe(false);
  });
});

describe("ACCEPTED_UPLOAD_EXTENSIONS", () => {
  it("covers both YAML and bundle extensions", () => {
    expect(ACCEPTED_UPLOAD_EXTENSIONS).toContain(".yaml");
    expect(ACCEPTED_UPLOAD_EXTENSIONS).toContain(".tar.gz");
  });
});

describe("FILE_INPUT_ACCEPT", () => {
  it("adds bare .gz so macOS' native dialog admits a compound .tar.gz", () => {
    const tokens = FILE_INPUT_ACCEPT.split(",");
    expect(tokens).toContain(".tar.gz");
    expect(tokens).toContain(".gz");
    expect(tokens).toContain(".yaml");
  });
});
