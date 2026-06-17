/**
 * @vitest-environment happy-dom
 *
 * The editor footer always exposes an install path: a split button (quick OTA
 * Update + a caret that opens the install-method picker) when an update is
 * available, and a plain Install (-> picker) otherwise — including when the
 * config is in sync, which previously rendered no install button at all.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

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
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders a split button (Update + picker caret) when an update is available", async () => {
    const el = await mount({ hasUpdateAvailable: true });
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

  it("renders a highlighted plain Install (-> picker) when there are pending changes", async () => {
    const el = await mount({ hasPendingChanges: true });
    const install = vi.fn();
    el.addEventListener("install-device", install);
    expect(q(el, ".install-split")).toBeNull();
    const btn = q(el, ".install-fab")!;
    expect(btn.classList.contains("install-fab--muted")).toBe(false); // there's something to apply
    btn.click();
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("shows a muted-but-usable Install when the config is in sync", async () => {
    const el = await mount({ hasUpdateAvailable: false, hasPendingChanges: false });
    const install = vi.fn();
    el.addEventListener("install-device", install);
    const btn = q(el, ".install-fab");
    expect(btn).not.toBeNull();
    expect(btn!.classList.contains("install-fab--muted")).toBe(true); // de-emphasized, nothing to apply
    btn!.click(); // still usable (re-flash)
    expect(install).toHaveBeenCalledTimes(1);
  });
});
