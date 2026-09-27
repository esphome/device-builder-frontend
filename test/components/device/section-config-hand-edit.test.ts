/**
 * @vitest-environment happy-dom
 *
 * The reload that follows a YAML edited outside the form comes up to a second
 * later. A change made in the form before it is written from the values in the
 * YAML, not from the ones the form had, so it does not undo the edit (#1920).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));
vi.mock("../../../src/components/device/config-entry-form.js", () => ({}));

import "../../_mock-webawesome.js";

import { flush } from "../../_dom.js";
import type { ESPHomeAPI } from "../../../src/api/index.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { ESPHomeDeviceSectionConfig } from "../../../src/components/device/device-section-config.js";
import type { YamlDraftDetail } from "../../../src/components/device/section-editor.js";
import { _clearComponentCache } from "../../../src/util/component-name-cache.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";
import { makeComponentEntry } from "../../util/_make-component-entry.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const YAML = ["logger:", "  level: DEBUG", ""].join("\n");
const EDITED = YAML.replace("DEBUG", "WARN");

async function mount() {
  const entry = makeComponentEntry("logger", {
    name: "Logger",
    config_entries: [
      makeConfigEntry({ key: "level", type: ConfigEntryType.STRING, label: "Level" }),
      makeConfigEntry({
        key: "baud_rate",
        type: ConfigEntryType.INTEGER,
        label: "Baud rate",
      }),
    ],
  });
  const c = new ESPHomeDeviceSectionConfig();
  const inner = c as any;
  inner._api = {
    getComponentBodies: () => Promise.resolve({ logger: entry }),
  } as unknown as ESPHomeAPI;
  inner._localize = (key: string) => key;
  c.configuration = "device.yaml";
  c.yaml = YAML;
  c.sectionKey = "logger";
  c.fromLine = 1;
  const drafts: string[] = [];
  // As the page does: a draft comes back as the YAML.
  c.addEventListener("yaml-draft", (e) => {
    const { yaml } = (e as CustomEvent<YamlDraftDetail>).detail;
    drafts.push(yaml);
    c.yaml = yaml;
  });
  document.body.appendChild(c);
  await c.updateComplete;
  await flush();
  await c.updateComplete;
  expect(inner._values).toEqual({ level: "DEBUG" });
  return { c, inner, drafts };
}

const change = (c: ESPHomeDeviceSectionConfig, path: string[], value: unknown) =>
  c
    .shadowRoot!.querySelector("esphome-config-entry-form")!
    .dispatchEvent(new CustomEvent("value-change", { detail: { path, value } }));

async function editByHand(c: ESPHomeDeviceSectionConfig, yaml = EDITED) {
  c.yaml = yaml;
  await c.updateComplete;
}

describe("a form change right after a YAML edited outside the form (#1920)", () => {
  beforeEach(() => {
    _clearComponentCache();
    document.body.innerHTML = "";
  });

  it("keeps the edit", async () => {
    const { c, inner, drafts } = await mount();
    await editByHand(c);
    expect(inner._values).toEqual({ level: "DEBUG" });

    change(c, ["baud_rate"], 9600);
    expect(inner._values).toEqual({ level: "WARN", baud_rate: 9600 });
    c.flushPending();

    expect(drafts).toEqual(["logger:\n  level: WARN\n  baud_rate: 9600\n"]);
  });

  it("keeps it for values applied from a notice", async () => {
    const { c, inner, drafts } = await mount();
    await editByHand(c);

    inner._onApplySectionValues(
      new CustomEvent("apply-section-values", {
        detail: { changes: [{ path: ["baud_rate"], value: 9600 }] },
      })
    );

    expect(drafts).toEqual(["logger:\n  level: WARN\n  baud_rate: 9600\n"]);
  });

  it("drops a write under a value the edit made plain", async () => {
    const { c, inner, drafts } = await mount();
    await editByHand(c);
    const told = inner._valuesRead;

    change(c, ["level", "inverted"], true);
    c.flushPending();

    expect(inner._values).toEqual({ level: "WARN" });
    expect(inner._valuesRead).toBe(told + 1);
    expect(c.dirty).toBe(false);
    expect(drafts).toEqual([]);
  });

  const apply = (inner: any, changes: { path: string[]; value: unknown }[]) =>
    inner._onApplySectionValues(
      new CustomEvent("apply-section-values", { detail: { changes } })
    );

  it("drops a value of a notice under a value the edit made plain, keeps the rest", async () => {
    const { c, inner, drafts } = await mount();
    await editByHand(c);
    const told = inner._valuesRead;

    apply(inner, [
      { path: ["level", "inverted"], value: true },
      { path: ["baud_rate"], value: 9600 },
    ]);

    expect(inner._valuesRead).toBe(told + 1);
    expect(drafts).toEqual(["logger:\n  level: WARN\n  baud_rate: 9600\n"]);
  });

  it("writes nothing when every value of a notice was dropped", async () => {
    const { c, inner, drafts } = await mount();
    await editByHand(c);

    apply(inner, [{ path: ["level", "inverted"], value: true }]);

    expect(inner._values).toEqual({ level: "WARN" });
    expect(c.dirty).toBe(false);
    expect(drafts).toEqual([]);
  });

  it("reads the values once, the next change builds on the one before", async () => {
    const { c, inner, drafts } = await mount();
    await editByHand(c);

    change(c, ["baud_rate"], 9600);
    change(c, ["level"], "ERROR");
    expect(inner._values).toEqual({ level: "ERROR", baud_rate: 9600 });
    c.flushPending();

    expect(drafts).toEqual(["logger:\n  level: ERROR\n  baud_rate: 9600\n"]);
  });

  it("does not read again for the draft the section wrote itself", async () => {
    const { c, inner, drafts } = await mount();
    change(c, ["baud_rate"], 9600);
    c.flushPending();
    await c.updateComplete;
    expect(c.yaml).toBe(drafts[0]);
    const read = inner._values;

    change(c, ["level"], "ERROR");

    expect(inner._values).toEqual({ ...read, level: "ERROR" });
    expect(inner._values.baud_rate).toBe(read.baud_rate);
  });

  it("keeps the values of a change on its way out when the edit lands", async () => {
    const { c, inner } = await mount();
    change(c, ["baud_rate"], 9600);

    await editByHand(c);

    change(c, ["baud_rate"], 115200);
    expect(inner._values).toEqual({ level: "DEBUG", baud_rate: 115200 });
  });

  it("builds on the values of the reload once it has read them", async () => {
    const { c, inner, drafts } = await mount();
    await editByHand(c);

    c.reload();
    await flush();
    await c.updateComplete;
    expect(inner._values).toEqual({ level: "WARN" });

    change(c, ["baud_rate"], 9600);
    c.flushPending();
    expect(drafts).toEqual(["logger:\n  level: WARN\n  baud_rate: 9600\n"]);
  });
});
