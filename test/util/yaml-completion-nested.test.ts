import { EditorState } from "@codemirror/state";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type ComponentCatalogEntry,
  ComponentCategory,
} from "../../src/api/types/components.js";
import { ConfigEntryType } from "../../src/api/types/config-entries.js";
import { _clearComponentCache } from "../../src/util/component-name-cache.js";
import { esphomeYaml } from "../../src/util/esphome-yaml-lang.js";
import {
  descendNestedEntries,
  nestedPathForParent,
  resolveAvailableEntries,
} from "../../src/util/yaml-completion-catalog.js";
import { makeComponentEntry } from "./_make-component-entry.js";
import { makeConfigEntry } from "./_make-config-entry.js";

const nested = (key: string, children: ReturnType<typeof makeConfigEntry>[]) =>
  makeConfigEntry({ key, type: ConfigEntryType.NESTED, config_entries: children });

// esp32 → framework (nested) → advanced (nested) → compiler_optimization.
const FRAMEWORK = nested("framework", [
  nested("advanced", [makeConfigEntry({ key: "compiler_optimization" })]),
  makeConfigEntry({ key: "version" }),
  makeConfigEntry({ key: "type" }),
]);

describe("descendNestedEntries", () => {
  const entries = [FRAMEWORK];

  it("descends one level into a nested group", () => {
    expect(descendNestedEntries(entries, ["framework"]).map((e) => e.key)).toEqual([
      "advanced",
      "version",
      "type",
    ]);
  });

  it("descends multiple levels", () => {
    expect(
      descendNestedEntries(entries, ["framework", "advanced"]).map((e) => e.key)
    ).toEqual(["compiler_optimization"]);
  });

  it("returns [] when a path step has no nested group", () => {
    expect(descendNestedEntries(entries, ["framework", "bogus"])).toEqual([]);
    expect(descendNestedEntries(entries, ["version"])).toEqual([]);
  });

  it("returns the input level for an empty path", () => {
    expect(descendNestedEntries(entries, [])).toBe(entries);
  });
});

describe("nestedPathForParent", () => {
  const pathAt = (yaml: string, parentKey: string) => {
    const state = EditorState.create({ doc: yaml, extensions: [esphomeYaml()] });
    return nestedPathForParent(state, yaml.length, parentKey);
  };

  it("yields the chain under the top-level component", () => {
    const yaml = ["esp32:", "  framework:", "    a"].join("\n");
    expect(pathAt(yaml, "framework")).toEqual(["framework"]);
  });

  it("yields a multi-level chain", () => {
    const yaml = ["esp32:", "  framework:", "    advanced:", "      x"].join("\n");
    expect(pathAt(yaml, "advanced")).toEqual(["framework", "advanced"]);
  });

  it("returns [] for the top-level key itself", () => {
    const yaml = ["esp32:", "  a"].join("\n");
    expect(pathAt(yaml, "esp32")).toEqual([]);
  });

  it("returns [] when the parent isn't on the key path", () => {
    const yaml = ["esp32:", "  framework:", "    a"].join("\n");
    expect(pathAt(yaml, "platform")).toEqual([]);
  });
});

describe("resolveAvailableEntries (nested descent)", () => {
  beforeEach(() => _clearComponentCache());

  it("descends a top-level component's nested config_entries", async () => {
    const slim = makeComponentEntry("esp32", { category: ComponentCategory.CORE });
    const body: ComponentCatalogEntry = { ...slim, config_entries: [FRAMEWORK] };
    const catalog = {
      components: [slim],
      byId: new Map([["esp32", slim]]),
      byCategory: new Map([[ComponentCategory.CORE, [slim]]]),
    };
    const fakeApi = {
      getComponentBodies: async (ids: string[]) =>
        Object.fromEntries(ids.filter((id) => id === "esp32").map((id) => [id, body])),
    } as never;
    const out = await resolveAvailableEntries(
      fakeApi,
      catalog,
      "framework", // parentKey from the indent walker (not a catalog id)
      null,
      "esp32",
      () => ["framework"]
    );
    expect(out.map((e) => e.key)).toEqual(["advanced", "version", "type"]);
  });
});
