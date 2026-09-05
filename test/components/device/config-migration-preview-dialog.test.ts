/**
 * @vitest-environment happy-dom
 *
 * Pins the migration preview dialog's reveal toggle: the diff opens
 * masked, the eye button flips it, and reopening resets to masked.
 */
import { describe, expect, it, vi } from "vitest";

import "../../_mock-webawesome.js";

import { baseDialog, mount } from "../../_dom.js";
import { expectTooltipsAnchored } from "../../_tooltip-anchors.js";
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
    expectTooltipsAnchored(el, 1);
    expect(el.shadowRoot!.querySelector("wa-tooltip[for]")!.getAttribute("for")).toBe(
      btn.id
    );
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

describe("config-migration preview dialog close path", () => {
  const stubWrapper = (el: ESPHomeConfigMigrationPreviewDialog) => {
    const wrapper = baseDialog(el) as HTMLElement & { requestClose?: () => void };
    wrapper.requestClose = vi.fn();
    return wrapper;
  };
  const isOpen = (el: ESPHomeConfigMigrationPreviewDialog): boolean =>
    (el as unknown as { _dialog: { open: boolean } })._dialog.open;

  it("keeps the diff rendered until the wrapper has finished hiding", async () => {
    const el = await mountOpen();
    const wrapper = stubWrapper(el);
    el.close();
    await el.updateComplete;
    expect(wrapper.requestClose).toHaveBeenCalledTimes(1);
    expect(isOpen(el)).toBe(true);
    expect(diffEl(el)).not.toBeNull();

    wrapper.dispatchEvent(new CustomEvent("after-hide"));
    await el.updateComplete;
    expect(isOpen(el)).toBe(false);
    expect(el.shadowRoot!.querySelector("esphome-yaml-diff")).toBeNull();
  });

  it("a second confirm during the hide does not request the migration again", async () => {
    const el = await mountOpen();
    stubWrapper(el);
    const requested = vi.fn();
    el.addEventListener("request-migrate-config", requested);
    const confirm = el.shadowRoot!.querySelector<HTMLButtonElement>(".btn--primary")!;
    confirm.click();
    confirm.click();
    expect(requested).toHaveBeenCalledTimes(1);
  });
});
