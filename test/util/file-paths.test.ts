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

  it("routes top-level YAMLs to the device editor and the rest to the file editor", () => {
    expect(openTargetUrl("kitchen.yaml")).toBe("/device/kitchen.yaml");
    expect(openTargetUrl("common/a.yaml")).toBe("/file/common/a.yaml");
    expect(openTargetUrl("a/b c.yaml")).toBe("/file/a/b%20c.yaml");
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
    ["common/base #1.yaml", "packages.path_characters"],
    ["common/a{b}.yaml", "packages.path_characters"],
    ["common/secrets.yaml", "packages.path_reserved"],
    ["Archive/x.yaml", "packages.path_reserved"],
  ])("newPackagePathProblem(%j) → %j", (input, expected) => {
    expect(newPackagePathProblem(input)).toBe(expected);
  });
});
