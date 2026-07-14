/**
 * @vitest-environment happy-dom
 *
 * The editor footer always exposes an install path: a split button (quick OTA
 * Update + a caret that opens the install-method picker) when an update is
 * available, and a plain Install (-> picker) otherwise — including when the
 * config is in sync, which previously rendered no install button at all.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
// Stub the heavy children (they pull in CodeMirror / wa-button); the footer
// under test uses plain buttons, so this keeps the mount light and quiet.
vi.mock("../../../src/components/device/device-board-info.js", () => ({}));
vi.mock("../../../src/components/yaml-editor.js", () => ({}));
vi.mock("../../../src/components/yaml-diff.js", () => ({}));

import { ESPHomeDeviceEditor } from "../../../src/components/device/device-editor.js";

async function mount(props: Partial<ESPHomeDeviceEditor>): Promise<ESPHomeDeviceEditor> {
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

describe("device-editor footer install action", () => {
  it("renders a split button (Update + picker caret) when an update is available", async () => {
    const el = await mount({ showUpdate: true });
    const update = vi.fn();
    const install = vi.fn();
    el.addEventListener("update-device", update);
    el.addEventListener("install-device", install);

    const main = q(el, ".install-split__main");
    const caret = q(el, ".install-split__caret");
    expect(main).not.toBeNull();
    expect(caret).not.toBeNull();

    main!.click(); // quick OTA stays one click
    caret!.click(); // caret opens the install-method picker (Web Serial etc.)
    expect(update).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("wires the installed + target versions into the Update button title", async () => {
    // Identity localize keeps the key; asserting the version key proves both
    // versions threaded through to the title (the helper's branch logic and
    // fallback are unit-tested in update-tooltip.test.ts).
    const el = await mount({
      showUpdate: true,
      installedVersion: "2024.6.0",
      availableVersion: "2024.12.0",
    });
    expect(q(el, ".install-split__main")!.title).toBe(
      "dashboard.update_available_version"
    );
  });

  it("renders a highlighted plain Install (-> picker) when there are pending changes", async () => {
    const el = await mount({ showModified: true });
    const install = vi.fn();
    el.addEventListener("install-device", install);
    expect(q(el, ".install-split")).toBeNull();
    const btn = q(el, ".install-fab")!;
    expect(btn.classList.contains("install-fab--muted")).toBe(false); // there's something to apply
    btn.click();
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("shows a muted-but-usable Install when the config is in sync", async () => {
    const el = await mount({ showUpdate: false, showModified: false });
    const install = vi.fn();
    el.addEventListener("install-device", install);
    const btn = q(el, ".install-fab");
    expect(btn).not.toBeNull();
    expect(btn!.classList.contains("install-fab--muted")).toBe(true); // de-emphasized, nothing to apply
    btn!.click(); // still usable (re-flash)
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("busy Update stays enabled and its visible label flips to view-progress", async () => {
    // The visible text IS the accessible name (no aria-label), so the flip
    // covers screen-reader and voice-control users alike (WCAG 2.5.3).
    const el = await mount({ showUpdate: true, busy: true });
    const main = q(el, ".install-split__main") as HTMLButtonElement;
    expect(main.disabled).toBe(false);
    expect(main.textContent).toContain("dashboard.table_action_view_progress");
    expect(main.textContent).not.toContain("dashboard.update");
    expect(main.hasAttribute("aria-label")).toBe(false);
    expect(main.title).toBe("dashboard.table_action_view_progress");
    // The caret can only start a *new* job, so it alone disables mid-job.
    expect((q(el, ".install-split__caret") as HTMLButtonElement).disabled).toBe(true);
  });

  it("busy Install stays enabled and its visible label flips to view-progress", async () => {
    const el = await mount({ showModified: true, busy: true });
    const btn = q(el, ".install-fab") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toContain("dashboard.table_action_view_progress");
    expect(btn.textContent).not.toContain("dashboard.install");
    expect(btn.hasAttribute("aria-label")).toBe(false);
    expect(btn.title).toBe("dashboard.table_action_view_progress");
  });
});
