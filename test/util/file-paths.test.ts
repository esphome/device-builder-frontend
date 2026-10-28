import { describe, expect, it } from "vitest";
import {
  fileEditorUrl,
  fileNameOf,
  folderOf,
  groupByFolder,
  newPackagePathProblem,
  openTargetUrl,
} from "../../src/util/file-paths.js";

describe("file-paths", () => {
  it("builds the file editor URL with literal slashes and encoded segments", () => {
    expect(fileEditorUrl("common/base.yaml")).toBe("/file/common/base.yaml");
    expect(fileEditorUrl("my dir/a#b.yaml")).toBe("/file/my%20dir/a%23b.yaml");
  });

  it("routes device YAMLs to the device editor and others to the file editor", () => {
    const devices = new Set(["kitchen.yaml"]);
    expect(openTargetUrl("kitchen.yaml", devices)).toBe("/device/kitchen.yaml");
    expect(openTargetUrl("_shared.yaml", devices)).toBe("/file/_shared.yaml");
    expect(openTargetUrl("common/a.yaml", devices)).toBe("/file/common/a.yaml");
    expect(openTargetUrl("/abs/a.yaml", devices)).toBeNull();
    expect(openTargetUrl("C:/abs/a.yaml", devices)).toBeNull();
  });

  it("splits folder and file name", () => {
    expect(folderOf("a/b/c.yaml")).toBe("a/b");
    expect(folderOf("c.yaml")).toBe("");
    expect(fileNameOf("a/b/c.yaml")).toBe("c.yaml");
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
    ["common/secrets.yaml", "packages.path_reserved"],
    ["Archive/x.yaml", "packages.path_reserved"],
  ])("newPackagePathProblem(%j) → %j", (input, expected) => {
    expect(newPackagePathProblem(input)).toBe(expected);
  });
});
