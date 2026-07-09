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
import { makeConfigEntry, makeNestedEntry as nested } from "./_make-config-entry.js";

// esp32 → framework (nested) → advanced (nested) → compiler_optimization.
const FRAMEWORK = nested("framework", [
  nested("advanced", [makeConfigEntry({ key: "compiler_optimization" })]),
  makeConfigEntry({ key: "version" }),
  makeConfigEntry({ key: "type" }),
]);

describe("descendNestedEntries", () => {
  const entries = [FRAMEWORK];

  it("descends one level into a nested group", () => {
    expect(descendNestedEntries(entries, ["framework"])!.map((e) => e.key)).toEqual([
      "advanced",
      "version",
      "type",
    ]);
  });

  it("descends multiple levels", () => {
    expect(
      descendNestedEntries(entries, ["framework", "advanced"])!.map((e) => e.key)
    ).toEqual(["compiler_optimization"]);
  });

  it("returns an empty array for a real but childless nested group", () => {
    const empty = [nested("framework", [nested("advanced", [])])];
    expect(descendNestedEntries(empty, ["framework", "advanced"])).toEqual([]);
  });

  it("descends a nested group whose children are null", () => {
    // ``config_entries`` is ``ConfigEntry[] | null``; a nested group with
    // null children resolves to an empty level, not a missing path.
    const nullChildren = makeConfigEntry({
      key: "framework",
      type: ConfigEntryType.NESTED,
      config_entries: null,
    });
    expect(descendNestedEntries([nullChildren], ["framework"])).toEqual([]);
  });

  it("returns null when a path step has no nested group", () => {
    expect(descendNestedEntries(entries, ["framework", "bogus"])).toBeNull();
    expect(descendNestedEntries(entries, ["version"])).toBeNull();
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

  it("resolves a blank indented line via indentation (AST is silent there)", () => {
    const yaml = ["esp32:", "  framework:", "    "].join("\n");
    expect(pathAt(yaml, "framework")).toEqual(["framework"]);
  });

  it("resolves a deep blank line via indentation", () => {
    const yaml = ["esp32:", "  framework:", "    advanced:", "      "].join("\n");
    expect(pathAt(yaml, "advanced")).toEqual(["framework", "advanced"]);
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

  it("descends a nested group whose key collides with a component id", async () => {
    // ``web_server`` is both a top-level component and a per-entity nested
    // group; the descent must win over the same-named component so the user
    // gets the nested group's fields, not the component's.
    const ws = makeComponentEntry("web_server", { category: ComponentCategory.CORE });
    const wsBody: ComponentCatalogEntry = {
      ...ws,
      config_entries: [
        makeConfigEntry({ key: "port" }),
        makeConfigEntry({ key: "auth" }),
      ],
    };
    const host = makeComponentEntry("esphome", { category: ComponentCategory.CORE });
    const hostBody: ComponentCatalogEntry = {
      ...host,
      config_entries: [
        nested("web_server", [makeConfigEntry({ key: "sorting_weight" })]),
      ],
    };
    const catalog = {
      components: [ws, host],
      byId: new Map([
        ["web_server", ws],
        ["esphome", host],
      ]),
      byCategory: new Map(),
    };
    const fakeApi = {
      getComponentBodies: async (ids: string[]) =>
        Object.fromEntries(
          ids
            .map((id) =>
              id === "web_server"
                ? [id, wsBody]
                : id === "esphome"
                  ? [id, hostBody]
                  : null
            )
            .filter((e): e is [string, ComponentCatalogEntry] => e !== null)
        ),
    } as never;
    const out = await resolveAvailableEntries(
      fakeApi,
      catalog,
      "web_server", // parentKey collides with a component id
      null,
      "esphome", // but the top-level block is esphome, so descend
      () => ["web_server"]
    );
    expect(out.map((e) => e.key)).toEqual(["sorting_weight"]);
  });

  it("merges the dotted platform impl, not a bare component sharing its name", async () => {
    // ``ota: - platform: esphome`` must merge ``ota.esphome`` (password/port),
    // not the core ``esphome`` component (name/areas) whose id collides with
    // the platform value.
    const ota = makeComponentEntry("ota", { category: ComponentCategory.CORE });
    const otaEsphome = makeComponentEntry("ota.esphome", {
      category: ComponentCategory.CORE,
    });
    const esphome = makeComponentEntry("esphome", { category: ComponentCategory.CORE });
    const bodies: Record<string, ComponentCatalogEntry> = {
      ota: { ...ota, config_entries: [makeConfigEntry({ key: "platform" })] },
      "ota.esphome": {
        ...otaEsphome,
        config_entries: [
          makeConfigEntry({ key: "password" }),
          makeConfigEntry({ key: "port" }),
        ],
      },
      esphome: {
        ...esphome,
        config_entries: [
          makeConfigEntry({ key: "name" }),
          makeConfigEntry({ key: "areas" }),
        ],
      },
    };
    const catalog = {
      components: [ota, otaEsphome, esphome],
      byId: new Map(Object.entries({ ota, "ota.esphome": otaEsphome, esphome })),
      byCategory: new Map(),
    };
    const fakeApi = {
      getComponentBodies: async (ids: string[]) =>
        Object.fromEntries(
          ids
            .filter((id) => Object.prototype.hasOwnProperty.call(bodies, id))
            .map((id) => [id, bodies[id]])
        ),
    } as never;
    const keys = (
      await resolveAvailableEntries(fakeApi, catalog, "ota", "esphome", "ota", () => [])
    ).map((e) => e.key);
    expect(keys).toContain("password");
    expect(keys).toContain("port");
    expect(keys).not.toContain("name");
    expect(keys).not.toContain("areas");
  });

  it("passes the device target so platform-resolved options surface", async () => {
    // The backend only fills `options` for fields like `hardware_uart` when
    // given the device platform/board; the completion must forward the target.
    const slim = makeComponentEntry("logger", { category: ComponentCategory.CORE });
    const resolved: ComponentCatalogEntry = {
      ...slim,
      config_entries: [
        makeConfigEntry({
          key: "hardware_uart",
          options: [{ label: "UART0", value: "UART0" }],
        }),
      ],
    };
    const generic: ComponentCatalogEntry = {
      ...slim,
      config_entries: [makeConfigEntry({ key: "hardware_uart", options: null })],
    };
    const catalog = {
      components: [slim],
      byId: new Map([["logger", slim]]),
      byCategory: new Map(),
    };
    const fakeApi = {
      // Resolve options only when BOTH platform and boardId are forwarded, so a
      // regression that drops boardId fails this test.
      getComponentBodies: async (ids: string[], platform?: string, boardId?: string) =>
        Object.fromEntries(
          ids
            .filter((id) => id === "logger")
            .map((id) => [id, platform && boardId ? resolved : generic])
        ),
    } as never;
    const withTarget = await resolveAvailableEntries(
      fakeApi,
      catalog,
      "logger",
      null,
      "logger",
      () => [],
      { platform: "esp32", boardId: "esp32-evb" }
    );
    expect(withTarget.find((e) => e.key === "hardware_uart")?.options).toEqual([
      { label: "UART0", value: "UART0" },
    ]);
    const noTarget = await resolveAvailableEntries(
      fakeApi,
      catalog,
      "logger",
      null,
      "logger",
      () => []
    );
    expect(noTarget.find((e) => e.key === "hardware_uart")?.options).toBeNull();
  });
});
