/**
 * @vitest-environment happy-dom
 *
 * The editor header toolbar: the reveal-sensitive toggle (hidden in the
 * components-only layout where no YAML is on screen), the editor/diff toggle
 * (only when expert mode exposes a diff button), and the three-way layout
 * switch. Extracted to device-editor-toolbar.ts but rendered into the
 * device-editor shadow root, so these assertions mount the real element.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
// Stub the heavy children (they pull in CodeMirror / wa-button); the toolbar
// under test uses plain buttons, so this keeps the mount light and quiet.
vi.mock("../../../src/components/device/device-board-info.js", () => ({}));
vi.mock("../../../src/components/yaml-editor.js", () => ({}));
vi.mock("../../../src/components/yaml-diff.js", () => ({}));

import { ESPHomeDeviceEditor } from "../../../src/components/device/device-editor.js";

// `_showDiffButton`, `_showDiff` and `_revealSensitive` are private @state but
// at runtime are plain fields; the loose record lets a test seed them.
type EditorState = Record<string, unknown>;

async function mount(props: Partial<ESPHomeDeviceEditor> & EditorState = {}) {
  const el = new ESPHomeDeviceEditor();
  el.yaml = "esphome:\n  name: x\n";
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function q(el: ESPHomeDeviceEditor, sel: string): HTMLElement | null {
  return el.shadowRoot!.querySelector<HTMLElement>(sel);
}

function qa(el: ESPHomeDeviceEditor, sel: string): HTMLElement[] {
  return Array.from(el.shadowRoot!.querySelectorAll<HTMLElement>(sel));
}

describe("device-editor header toolbar", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the three-way layout switch with the active layout pressed", async () => {
    const el = await mount({ layout: "both" });
    const buttons = qa(el, ".layout-toggle button");
    expect(buttons).toHaveLength(3);
    const split = q(el, ".layout-toggle .split-btn")!;
    expect(split.getAttribute("aria-pressed")).toBe("true");
  });

  it("emits a layout-change event with the chosen layout", async () => {
    const el = await mount({ layout: "both" });
    const onLayout = vi.fn();
    el.addEventListener("layout-change", (e) =>
      onLayout((e as CustomEvent<string>).detail)
    );
    // The components-only button is the first in the layout-toggle group.
    qa(el, ".layout-toggle button")[0].click();
    expect(onLayout).toHaveBeenCalledTimes(1);
    expect(onLayout).toHaveBeenCalledWith("left");
  });

  it("hides the reveal-sensitive toggle in the components-only layout", async () => {
    const both = await mount({ layout: "both" });
    expect(q(both, '[aria-label="device.yaml_reveal_sensitive"]')).not.toBeNull();

    const left = await mount({ layout: "left" });
    expect(q(left, '[aria-label="device.yaml_reveal_sensitive"]')).toBeNull();
    expect(q(left, '[aria-label="device.yaml_mask_sensitive"]')).toBeNull();
  });

  it("toggles the reveal-sensitive state on click", async () => {
    const el = await mount({ layout: "both" });
    const btn = q(el, '[aria-label="device.yaml_reveal_sensitive"]')!;
    expect(btn.querySelector("wa-icon")!.getAttribute("name")).toBe("eye");
    expect(btn.getAttribute("aria-pressed")).toBe("false");

    btn.click();
    await el.updateComplete;

    const masked = q(el, '[aria-label="device.yaml_mask_sensitive"]')!;
    expect(masked.querySelector("wa-icon")!.getAttribute("name")).toBe("eye-off");
    expect(masked.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the diff toggle only when expert mode exposes it", async () => {
    const off = await mount({ layout: "both" });
    expect(q(off, '[aria-label="device.diff_view_diff"]')).toBeNull();

    const on = await mount({ layout: "both", _showDiffButton: true });
    const btn = q(on, '[aria-label="device.diff_view_diff"]')!;
    expect(btn).not.toBeNull();

    btn.click();
    await on.updateComplete;
    // Flips into diff view: the button now offers the way back to the editor.
    expect(q(on, '[aria-label="device.diff_view_editor"]')).not.toBeNull();
  });
});
