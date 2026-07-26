/**
 * @vitest-environment happy-dom
 *
 * Behavioral pins for the #160 regression class: the structured form
 * and form-driven validation must both consume
 * ``resolveSectionEntries``' output, not the raw catalog. A previous
 * iteration had the override defined but bound the form's
 * ``.entries`` to the catalog, leaving substitutions silently empty;
 * the sibling bug validated the resolver-rendered MAP shape against
 * the catalog's flat schema, so saves bailed on phantom required
 * fields (#1504 replaced the source-text scans that guarded this).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));
vi.mock("../../../src/components/device/config-entry-form.js", () => ({}));

import "../../_mock-webawesome.js";

import {
  type ConfigEntry,
  ConfigEntryType,
} from "../../../src/api/types/config-entries.js";
import { ESPHomeDeviceSectionConfig } from "../../../src/components/device/device-section-config.js";
import { flushDraft } from "../../../src/components/device/device-section-config/draft-and-delete.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";
import { resolveSectionEntries } from "../../../src/util/section-entry-overrides.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ``configuration`` stays unset so mounting doesn't kick loadConfig
// (which would need an _api and overwrite the preset _config).
function makeHost(sectionKey: string, entries: ConfigEntry[]) {
  const c = new ESPHomeDeviceSectionConfig();
  const inner = c as any;
  inner.sectionKey = sectionKey;
  inner._localize = (key: string) => key;
  inner._config = { title: sectionKey, entries };
  inner._presentComponents = new Set<string>();
  return { c, inner };
}

// The catalog ships substitutions with a flat schema the user-keyed
// MAP shape doesn't match (a required field the user rows never
// carry) — the shape that made raw-catalog consumers misrender (#160)
// and mis-validate.
const bogusCatalog = () => [
  makeConfigEntry({
    key: "url",
    type: ConfigEntryType.STRING,
    label: "String",
    required: true,
    advanced: true,
  }),
];

describe("structured form entries wiring", () => {
  it("binds the form's .entries to the resolver's output, not the raw catalog", async () => {
    const catalog = bogusCatalog();
    const { c } = makeHost("substitutions", catalog);
    document.body.appendChild(c);
    await c.updateComplete;

    const form = c.shadowRoot!.querySelector("esphome-config-entry-form") as any;
    expect(form).not.toBeNull();
    expect(form.entries).toBe(resolveSectionEntries("substitutions", catalog));
    expect(form.entries).not.toBe(catalog);
    expect(form.entries[0].type).toBe(ConfigEntryType.MAP);
  });

  it("hands a non-overridden section's catalog to the form unchanged", async () => {
    const catalog = [makeConfigEntry({ key: "ssid", required: true })];
    const { c } = makeHost("wifi", catalog);
    document.body.appendChild(c);
    await c.updateComplete;

    const form = c.shadowRoot!.querySelector("esphome-config-entry-form") as any;
    expect(form.entries).toBe(catalog);
  });
});

describe("flushDraft validation routing", () => {
  it("validates user-keyed MAP values against the resolver's schema, then drafts", () => {
    const { c, inner } = makeHost("substitutions", bogusCatalog());
    inner.configuration = "device.yaml";
    inner.yaml = "substitutions:\n  old: gone\n";
    inner.fromLine = 1;
    inner._values = { ApolloAutomation: "github://example/repo" };
    const drafts: string[] = [];
    c.addEventListener("yaml-draft", (e) =>
      drafts.push((e as CustomEvent).detail.yaml as string)
    );

    flushDraft(c);

    // Validated against the raw catalog, the missing required "url"
    // would populate _fieldErrors and phantom-error every keystroke.
    expect(inner._fieldErrors.size).toBe(0);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toContain('ApolloAutomation: "github://example/repo"');
  });

  it("still enforces catalog requirements for pass-through sections", () => {
    const { c, inner } = makeHost("wifi", [
      makeConfigEntry({ key: "ssid", type: ConfigEntryType.STRING, required: true }),
    ]);
    inner.yaml = "wifi:\n  password: hunter2\n";
    inner.fromLine = 1;
    inner._values = { password: "hunter2" };

    flushDraft(c);

    expect(inner._fieldErrors.has("ssid")).toBe(true);
  });
});
