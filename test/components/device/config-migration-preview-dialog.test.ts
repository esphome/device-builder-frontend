/**
 * @vitest-environment happy-dom
 *
 * Pins the migration preview dialog's reveal toggle: the diff opens
 * masked, the eye button flips it, and reopening resets to masked.
 */
import { describe, expect, it } from "vitest";

import "../../_mock-webawesome.js";

import { ESPHomeConfigMigrationPreviewDialog } from "../../../src/components/device/config-migration-preview-dialog.js";
import type { ESPHomeYamlDiff } from "../../../src/components/yaml-diff.js";

const OLD_YAML = "wifi:\n  password: hunter2\n  use_addres: 1.2.3.4\n";
const NEW_YAML = "wifi:\n  password: hunter2\n  use_address: 1.2.3.4\n";

async function mountOpen() {
  const el = new ESPHomeConfigMigrationPreviewDialog();
  el.configuration = "kitchen.yaml";
  el.oldValue = OLD_YAML;
  el.newValue = NEW_YAML;
  document.body.appendChild(el);
  el.open();
  await el.updateComplete;
  return el;
}

function diffEl(el: ESPHomeConfigMigrationPreviewDialog): ESPHomeYamlDiff {
  return el.shadowRoot!.querySelector<ESPHomeYamlDiff>("esphome-yaml-diff")!;
}

describe("config-migration preview dialog reveal toggle", () => {
  it("opens masked and flips the diff on click", async () => {
    const el = await mountOpen();
    expect(diffEl(el).revealSensitive).toBe(false);

    const btn = el.shadowRoot!.querySelector<HTMLButtonElement>(
      '[aria-label="device.yaml_reveal_sensitive"]'
    )!;
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    btn.click();
    await el.updateComplete;

    expect(diffEl(el).revealSensitive).toBe(true);
    const masked = el.shadowRoot!.querySelector<HTMLButtonElement>(
      '[aria-label="device.yaml_mask_sensitive"]'
    )!;
    expect(masked.getAttribute("aria-pressed")).toBe("true");
  });

  it("resets to masked on reopen", async () => {
    const el = await mountOpen();
    el.shadowRoot!.querySelector<HTMLButtonElement>(
      '[aria-label="device.yaml_reveal_sensitive"]'
    )!.click();
    await el.updateComplete;
    expect(diffEl(el).revealSensitive).toBe(true);

    el.close();
    await el.updateComplete;
    el.open();
    await el.updateComplete;
    expect(diffEl(el).revealSensitive).toBe(false);
  });
});
