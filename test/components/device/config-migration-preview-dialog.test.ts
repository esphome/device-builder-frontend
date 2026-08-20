/**
 * @vitest-environment happy-dom
 *
 * Pins the migration preview dialog's reveal toggle: the diff opens
 * masked, the eye button flips it, and reopening resets to masked.
 */
import { describe, expect, it } from "vitest";

import "../../_mock-webawesome.js";

import { mount } from "../../_dom.js";
import { ESPHomeConfigMigrationPreviewDialog } from "../../../src/components/device/config-migration-preview-dialog.js";
import type { ESPHomeYamlDiff } from "../../../src/components/yaml-diff.js";

const OLD_YAML = "wifi:\n  password: hunter2\n  use_addres: 1.2.3.4\n";
const NEW_YAML = "wifi:\n  password: hunter2\n  use_address: 1.2.3.4\n";

async function mountOpen() {
  const el = await mount(new ESPHomeConfigMigrationPreviewDialog(), {
    configuration: "kitchen.yaml",
    oldValue: OLD_YAML,
    newValue: NEW_YAML,
  });
  el.open();
  await el.updateComplete;
  return el;
}

function diffEl(el: ESPHomeConfigMigrationPreviewDialog): ESPHomeYamlDiff {
  return el.shadowRoot!.querySelector<ESPHomeYamlDiff>("esphome-yaml-diff")!;
}

function toggle(
  el: ESPHomeConfigMigrationPreviewDialog,
  key: "reveal" | "mask"
): HTMLButtonElement {
  return el.shadowRoot!.querySelector<HTMLButtonElement>(
    `[aria-label="device.yaml_${key}_sensitive"]`
  )!;
}

describe("config-migration preview dialog reveal toggle", () => {
  it("opens masked and flips the diff on click", async () => {
    const el = await mountOpen();
    expect(diffEl(el).revealSensitive).toBe(false);

    const btn = toggle(el, "reveal");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    btn.click();
    await el.updateComplete;

    expect(diffEl(el).revealSensitive).toBe(true);
    expect(toggle(el, "mask").getAttribute("aria-pressed")).toBe("true");
  });

  it("anchors a wa-tooltip to the reveal toggle, with no native title", async () => {
    const el = await mountOpen();
    const btn = toggle(el, "reveal");
    expect(btn.hasAttribute("title")).toBe(false);
    const tip = el.shadowRoot!.querySelector("wa-tooltip[for]")!;
    expect(tip.getAttribute("for")).toBe(btn.id);
  });

  it("resets to masked on reopen", async () => {
    const el = await mountOpen();
    toggle(el, "reveal").click();
    await el.updateComplete;
    expect(diffEl(el).revealSensitive).toBe(true);

    el.close();
    await el.updateComplete;
    el.open();
    await el.updateComplete;
    expect(diffEl(el).revealSensitive).toBe(false);
  });
});
