/**
 * Tests for the schema-gated invalid-option auto-fix: the buffer walk finds
 * a dedented key under a value-less opener, and the component catalog must
 * confirm the key belongs to the opener (and not to its current parent)
 * before the re-indent is offered.
 */
import { EditorState } from "@codemirror/state";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ComponentCategory,
  type ComponentCatalogEntry,
} from "../../src/api/types/components.js";
import { ConfigEntryType } from "../../src/api/types/config-entries.js";
import { _clearComponentCache } from "../../src/util/component-name-cache.js";
import { esphomeYaml } from "../../src/util/esphome-yaml-lang.js";
import { lineAccessorFor } from "../../src/util/yaml-error-analysis.js";
import { describeInvalidOptionFix } from "../../src/util/yaml-invalid-option-fix.js";
import { makeComponentEntry } from "./_make-component-entry.js";
import { makeConfigEntry } from "./_make-config-entry.js";

const nested = (key: string, children: ReturnType<typeof makeConfigEntry>[]) =>
  makeConfigEntry({ key, type: ConfigEntryType.NESTED, config_entries: children });

const SLIMS = ["api", "esp32", "wifi"].map((id) =>
  makeComponentEntry(id, { category: ComponentCategory.CORE })
);
const BODIES: Record<string, ComponentCatalogEntry> = {
  api: {
    ...SLIMS[0],
    config_entries: [
      nested("encryption", [
        makeConfigEntry({ key: "key" }),
        makeConfigEntry({ key: "port" }),
      ]),
      makeConfigEntry({ key: "port" }),
    ],
  },
  esp32: {
    ...SLIMS[1],
    config_entries: [
      nested("framework", [
        nested("advanced", [makeConfigEntry({ key: "ignore_efuse_mac_crc" })]),
        makeConfigEntry({ key: "version" }),
      ]),
    ],
  },
  wifi: {
    ...SLIMS[2],
    config_entries: [
      makeConfigEntry({ key: "ssid" }),
      nested("manual_ip", [makeConfigEntry({ key: "static_ip" })]),
    ],
  },
};

// ``loadCatalog`` caches its promise for the module's lifetime, so every
// test shares one catalog surface; bodies re-fetch per test through the
// cleared component cache.
const fakeApi = (
  bodies: (ids: string[]) => Record<string, ComponentCatalogEntry> | never
) =>
  ({
    getComponents: async () => ({ components: SLIMS }),
    getComponentBodies: async (ids: string[]) => bodies(ids),
  }) as never;

const defaultApi = fakeApi((ids) =>
  Object.fromEntries(ids.filter((id) => id in BODIES).map((id) => [id, BODIES[id]]))
);

const localize = (key: string, values?: Record<string, string | number>): string =>
  `${key}:${JSON.stringify(values)}`;

const run = (yaml: string, message: string, blamedLine: number, api = defaultApi) =>
  describeInvalidOptionFix({
    api,
    state: EditorState.create({ doc: yaml, extensions: [esphomeYaml()] }),
    readLine: lineAccessorFor(yaml),
    message,
    blamedLine,
    localize,
  });

const DEDENTED_KEY = ["api:", "  encryption:", "  key: !secret x"].join("\n");
const KEY_MESSAGE = "[key] is an invalid option for [api]. Please check the indentation.";

describe("describeInvalidOptionFix", () => {
  beforeEach(() => _clearComponentCache());

  it("offers the re-indent when the schema confirms the opener owns the key", async () => {
    expect(await run(DEDENTED_KEY, KEY_MESSAGE, 3)).toEqual({
      text: 'yaml_editor.error_nest_under_fix:{"line":3,"key":"key","parent":"encryption","spaces":2}',
      fix: { line: 3, indent: 2, key: "key", fromIndent: 2 },
    });
  });

  it("offers the fix on the did-you-mean variant too", async () => {
    const yaml = ["wifi:", "  manual_ip:", "  static_ip: 1.2.3.4"].join("\n");
    const message =
      "[static_ip] is an invalid option for [wifi]. Did you mean [use_address]?";
    expect(await run(yaml, message, 3)).toMatchObject({
      fix: { line: 3, indent: 2, key: "static_ip", fromIndent: 2 },
    });
  });

  it("descends nested openers below the top level", async () => {
    const yaml = [
      "esp32:",
      "  framework:",
      "    advanced:",
      "    ignore_efuse_mac_crc: true",
    ].join("\n");
    const message = "[ignore_efuse_mac_crc] is an invalid option for [framework].";
    expect(await run(yaml, message, 4)).toMatchObject({
      fix: { line: 4, indent: 2, key: "ignore_efuse_mac_crc", fromIndent: 4 },
    });
  });

  it("returns null when the key is not an option of the opener", async () => {
    const yaml = ["api:", "  encryption:", "  bogus: x"].join("\n");
    const message = "[bogus] is an invalid option for [api].";
    expect(await run(yaml, message, 3)).toBeNull();
  });

  it("returns null when the key is also valid under the current parent", async () => {
    const yaml = ["api:", "  encryption:", "  port: 6053"].join("\n");
    const message = "[port] is an invalid option for [api].";
    expect(await run(yaml, message, 3)).toBeNull();
  });

  it("returns null when the message's parent is not the buffer's parent", async () => {
    expect(
      await run(DEDENTED_KEY, "[key] is an invalid option for [wifi].", 3)
    ).toBeNull();
  });

  it("returns null for a component the catalog doesn't know", async () => {
    const yaml = ["nonexistent:", "  encryption:", "  key: x"].join("\n");
    const message = "[key] is an invalid option for [nonexistent].";
    expect(await run(yaml, message, 3)).toBeNull();
  });

  it("returns null when the body fetch fails", async () => {
    const failing = fakeApi(() => {
      throw new Error("boom");
    });
    expect(await run(DEDENTED_KEY, KEY_MESSAGE, 3, failing)).toBeNull();
  });

  it("returns null for a message with no dedent shape behind it", async () => {
    const yaml = ["api:", "  bogus: x"].join("\n");
    expect(await run(yaml, "[bogus] is an invalid option for [api].", 2)).toBeNull();
  });
});
