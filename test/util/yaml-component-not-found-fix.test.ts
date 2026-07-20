/**
 * Tests for the schema-gated stray-top-level-key auto-fix: a column-0 key
 * ESPHome rejects as an unknown component gets a one-line indent under the
 * section above it only when the catalog confirms that section accepts it.
 */
import { EditorState } from "@codemirror/state";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ComponentCategory,
  type ComponentCatalogEntry,
} from "../../src/api/types/components.js";
import { _clearComponentCache } from "../../src/util/component-name-cache.js";
import { esphomeYaml } from "../../src/util/esphome-yaml-lang.js";
import { describeComponentNotFoundFix } from "../../src/util/yaml-component-not-found-fix.js";
import { makeComponentEntry } from "./_make-component-entry.js";
import { makeConfigEntry } from "./_make-config-entry.js";

const SLIMS = ["logger", "sensor"].map((id) =>
  makeComponentEntry(id, { category: ComponentCategory.CORE })
);
const BODIES: Record<string, ComponentCatalogEntry> = {
  logger: {
    ...SLIMS[0],
    config_entries: [
      makeConfigEntry({ key: "baud_rate" }),
      makeConfigEntry({ key: "id" }),
    ],
  },
  sensor: { ...SLIMS[1], config_entries: [makeConfigEntry({ key: "id" })] },
};

const fakeApi = (bodies: (ids: string[]) => Record<string, ComponentCatalogEntry>) =>
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
  describeComponentNotFoundFix({
    api,
    state: EditorState.create({ doc: yaml, extensions: [esphomeYaml()] }),
    message,
    blamedLine,
    localize,
  });

const STRAY_ID = ["logger:", "  baud_rate: 115200", "id: mylogger"].join("\n");
const MESSAGE = "Component not found: id.";

describe("describeComponentNotFoundFix", () => {
  beforeEach(() => _clearComponentCache());

  it("offers the indent when the section above accepts the key", async () => {
    expect(await run(STRAY_ID, MESSAGE, 3)).toEqual({
      text: 'yaml_editor.error_indent_under_section_fix:{"line":3,"key":"id","section":"logger","spaces":2}',
      fix: { line: 3, indent: 2, key: "id", fromIndent: 0 },
    });
  });

  it("follows the section's own child indent", async () => {
    const yaml = ["logger:", "    baud_rate: 115200", "id: mylogger"].join("\n");
    expect(await run(yaml, MESSAGE, 3)).toMatchObject({
      fix: { line: 3, indent: 4, key: "id", fromIndent: 0 },
    });
  });

  it("uses the canonical step for a childless opener", async () => {
    const yaml = ["logger:", "id: mylogger"].join("\n");
    expect(await run(yaml, MESSAGE, 2)).toMatchObject({
      fix: { line: 2, indent: 2, key: "id", fromIndent: 0 },
    });
  });

  it("returns null when the key is not an option of the section", async () => {
    expect(
      await run(STRAY_ID.replace(/^id:/m, "ssid:"), "Component not found: ssid.", 3)
    ).toBeNull();
  });

  it("returns null when there is no section above", async () => {
    expect(await run("id: mylogger", MESSAGE, 1)).toBeNull();
  });

  it("returns null when the line above is a complete pair, not an opener", async () => {
    const yaml = ["logger: {}", "id: mylogger"].join("\n");
    expect(await run(yaml, MESSAGE, 2)).toBeNull();
  });

  it("returns null for a list-shaped section", async () => {
    const yaml = ["sensor:", "  - platform: template", "id: mysensor"].join("\n");
    expect(await run(yaml, MESSAGE, 3)).toBeNull();
  });

  it("returns null when the blamed line is not a column-0 key line", async () => {
    const yaml = ["logger:", "  id: mylogger"].join("\n");
    expect(await run(yaml, MESSAGE, 2)).toBeNull();
  });

  it("returns null for a message that names a different key", async () => {
    expect(await run(STRAY_ID, "Component not found: tag.", 3)).toBeNull();
  });

  it("returns null for a non-matching message", async () => {
    expect(await run(STRAY_ID, "expected a dictionary.", 3)).toBeNull();
  });

  it("returns null when the body fetch fails", async () => {
    const failing = fakeApi(() => {
      throw new Error("boom");
    });
    expect(await run(STRAY_ID, MESSAGE, 3, failing)).toBeNull();
  });
});
