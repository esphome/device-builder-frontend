import { describe, expect, it } from "vitest";
import {
  deviceEditorUrl,
  fileEditorUrl,
  fileNameOf,
  fileStemOf,
  folderOf,
  groupByFolder,
  isArchivedPath,
  isDevicePath,
  isHiddenPath,
  isPackagePath,
  isSecretsFile,
  isSecretsLikeName,
  newPackagePathProblem,
  openTargetUrl,
  renamedConfiguration,
} from "../../src/util/file-paths.js";

describe("file-paths", () => {
  it("builds the file editor URL with literal slashes and encoded segments", () => {
    expect(fileEditorUrl("common/base.yaml")).toBe("/file/common/base.yaml");
    expect(fileEditorUrl("my dir/a#b.yaml")).toBe("/file/my%20dir/a%23b.yaml");
  });

  it("builds the device editor URL with literal slashes and encoded segments", () => {
    expect(deviceEditorUrl("kitchen.yaml")).toBe("/device/kitchen.yaml");
    expect(deviceEditorUrl("my device#1.yaml")).toBe("/device/my%20device%231.yaml");
    expect(deviceEditorUrl("devices/lights/desk led.yaml")).toBe(
      "/device/devices/lights/desk%20led.yaml"
    );
  });

  it("routes devices to the device editor and the rest to the file editor", () => {
    expect(openTargetUrl("kitchen.yaml")).toBe("/device/kitchen.yaml");
    expect(openTargetUrl("devices/lights/desk.yaml")).toBe(
      "/device/devices/lights/desk.yaml"
    );
    expect(openTargetUrl("common/a.yaml")).toBe("/file/common/a.yaml");
    expect(openTargetUrl("a/b c.yaml")).toBe("/file/a/b%20c.yaml");
    expect(openTargetUrl(".common.yaml")).toBe("/file/.common.yaml");
    expect(openTargetUrl("common/.hidden.yaml")).toBe("/file/common/.hidden.yaml");
  });

  it("sends the top-level secrets file to the Secrets page, other secrets files nowhere", () => {
    expect(openTargetUrl("secrets.yaml")).toBe("/secrets");
    expect(openTargetUrl("Secrets.YML")).toBe("/secrets");
    expect(openTargetUrl("secrets.ci.yaml")).toBeNull();
    expect(openTargetUrl("common/secrets.yaml")).toBeNull();
    expect(openTargetUrl("devices/secrets.local.yml")).toBeNull();
  });

  it("flags hidden paths at any depth", () => {
    expect(isHiddenPath(".common.yaml")).toBe(true);
    expect(isHiddenPath("a/.b/c.yaml")).toBe(true);
    expect(isHiddenPath("a/b.yaml")).toBe(false);
  });

  it.each([
    ["kitchen.yaml", true],
    ["devices/desk.yaml", true],
    ["devices/lights/desk-led-strip.yaml", true],
    ["devices/a/b/c.yml", true],
    ["common/wifi.yaml", false],
    ["Devices/desk.yaml", false],
    ["common/devices/desk.yaml", false],
    ["devicesx/desk.yaml", false],
    ["secrets.yaml", false],
    ["secrets.yml", false],
    ["Secrets.CI.yaml", false],
    ["devices/garage/secrets.yaml", false],
    ["devices/garage/secrets.local.yml", false],
    ["secretsx.yaml", true],
    ["my-secrets.yaml", true],
    ["secrets..yaml", false],
    ["devices/a/secrets..yaml", false],
    ["notes.txt", false],
    ["devices/x.txt", false],
    ["devices/.old/x.yaml", false],
    [".hidden.yaml", false],
    ["devices//x.yaml", false],
    ["", false],
  ])("isDevicePath(%j) → %j", (path, expected) => {
    expect(isDevicePath(path)).toBe(expected);
  });

  it.each([
    ["common/wifi.yaml", true],
    ["templates/a/b.yaml", true],
    ["kitchen.yaml", false],
    ["devices/lights/desk.yaml", false],
    ["common/secrets.yaml", false],
    ["common/secrets.ci.yaml", false],
    ["archive/old.yaml", false],
    ["Archive/old.yaml", false],
    ["common/.x.yaml", false],
    [".git/x.yaml", false],
    ["common/x.txt", false],
    ["common/secrets..yaml", false],
  ])("isPackagePath(%j) → %j", (path, expected) => {
    expect(isPackagePath(path)).toBe(expected);
  });

  it("recognises secrets-like names at any depth", () => {
    expect(isSecretsLikeName("secrets.yaml")).toBe(true);
    expect(isSecretsLikeName("a/b/secrets.ci.yml")).toBe(true);
    // Mirrors the backend literally: ``secrets.`` prefix plus a YAML suffix,
    // after Win32's trailing dots and spaces are dropped.
    expect(isSecretsLikeName("secrets..yaml")).toBe(true);
    expect(isSecretsLikeName("secrets.yaml. ")).toBe(true);
    expect(isSecretsLikeName("a/secret.yaml")).toBe(false);
    expect(isSecretsLikeName("secretsx.yaml")).toBe(false);
  });

  it("recognises only secrets.yaml / .yml as the secrets file", () => {
    expect(isSecretsFile("secrets.yaml")).toBe(true);
    expect(isSecretsFile("devices/a/Secrets.YML")).toBe(true);
    expect(isSecretsFile("secrets.yaml.")).toBe(true);
    expect(isSecretsFile("secrets.ci.yaml")).toBe(false);
    expect(isSecretsFile("my-secrets.yaml")).toBe(false);
  });

  it.each([
    ["archive/old.yaml", true],
    ["ARCHIVE/old.yaml", true],
    ["archived/old.yaml", false],
    ["archive.yaml", false],
    ["/archive/old.yaml", false],
    ["common/archive/x.yaml", false],
  ])("isArchivedPath(%j) → %j", (path, expected) => {
    expect(isArchivedPath(path)).toBe(expected);
  });

  it("splits folder and file name", () => {
    expect(folderOf("a/b/c.yaml")).toBe("a/b");
    expect(folderOf("c.yaml")).toBe("");
    expect(fileNameOf("a/b/c.yaml")).toBe("c.yaml");
  });

  it("takes the stem of the file name, dropping the folder", () => {
    expect(fileStemOf("kitchen.yaml")).toBe("kitchen");
    expect(fileStemOf("devices/lights/desk.YML")).toBe("desk");
    expect(fileStemOf("devices/lights/notes")).toBe("notes");
  });

  it("renames a configuration in place, keeping folder and extension", () => {
    expect(renamedConfiguration("kitchen.yaml", "pantry")).toBe("pantry.yaml");
    expect(renamedConfiguration("kitchen.yml", "pantry")).toBe("pantry.yml");
    expect(renamedConfiguration("kitchen", "pantry")).toBe("pantry.yaml");
    expect(renamedConfiguration("devices/lights/desk.yaml", "lamp")).toBe(
      "devices/lights/lamp.yaml"
    );
  });

  it("groups by folder in input order", () => {
    expect([
      ...groupByFolder(["a/x.yaml", "b/y.yaml", "a/z.yaml", "a/s/t.yaml"]),
    ]).toEqual([
      ["a", ["a/x.yaml", "a/z.yaml"]],
      ["b", ["b/y.yaml"]],
      ["a/s", ["a/s/t.yaml"]],
    ]);
  });

  it.each([
    ["common/base.yaml", null],
    [" common/sub/x.yml ", null],
    ["base.yaml", "packages.path_needs_folder"],
    ["common//x.yaml", "packages.path_needs_folder"],
    ["/common/x.yaml", "packages.path_needs_folder"],
    ["../x/y.yaml", "packages.path_invalid"],
    ["common/.x.yaml", "packages.path_invalid"],
    ["common\\x.yaml", "packages.path_needs_folder"],
    ["c:/x.yaml", "packages.path_invalid"],
    ["common/x.txt", "packages.path_needs_yaml"],
    ["common/base #1.yaml", "packages.path_characters"],
    ["common/a{b}.yaml", "packages.path_characters"],
    ["common/price$usd.yaml", "packages.path_characters"],
    ["common/@main.yaml", "packages.path_start"],
    ["!x/main.yaml", "packages.path_start"],
    ["common/_main.yaml", null],
    ["共有/éclairage.yaml", null],
    ["common/secrets.yaml", "packages.path_reserved"],
    ["Archive/x.yaml", "packages.path_reserved"],
    ["common/secrets.ci.yaml", "packages.path_reserved"],
    ["devices/secrets.yaml", "packages.path_reserved"],
    ["devices/shared.yaml", "packages.path_in_devices"],
    ["devices/lights/shared.yaml", "packages.path_in_devices"],
    ["Devices/shared.yaml", null],
    ["common/devices/x.yaml", null],
  ])("newPackagePathProblem(%j) → %j", (input, expected) => {
    expect(newPackagePathProblem(input)).toBe(expected);
  });
});
