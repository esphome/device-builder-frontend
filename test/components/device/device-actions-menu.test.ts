/**
 * @vitest-environment happy-dom
 *
 * The editor bottom-bar device-actions menu: renders Logs + Clean build,
 * emits open-logs / clean-build, and gates Clean build behind `busy`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeDeviceActionsMenu } from "../../../src/components/device/device-actions-menu.js";
import { identityLocalize } from "../../_dom.js";

afterEach(() => {
  vi.clearAllMocks();
});

async function mount(busy = false): Promise<ESPHomeDeviceActionsMenu> {
  const el = new ESPHomeDeviceActionsMenu();
  (el as unknown as { _localize: typeof identityLocalize })._localize = identityLocalize;
  el.busy = busy;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function items(el: ESPHomeDeviceActionsMenu): HTMLElement[] {
  return Array.from(el.shadowRoot!.querySelectorAll<HTMLElement>(".menu-item"));
}

async function openMenu(el: ESPHomeDeviceActionsMenu): Promise<HTMLElement[]> {
  el.shadowRoot!.querySelector<HTMLElement>(".menu-btn")!.click();
  await el.updateComplete;
  return items(el);
}

describe("esphome-device-actions-menu", () => {
  it("is closed until the kebab is clicked", async () => {
    const el = await mount();
    expect(items(el)).toHaveLength(0);
    const opened = await openMenu(el);
    expect(opened).toHaveLength(2);
  });

  it("emits open-logs when Logs is clicked", async () => {
    const el = await mount();
    const onLogs = vi.fn();
    el.addEventListener("open-logs", onLogs);
    const [logs] = await openMenu(el);
    logs.click();
    expect(onLogs).toHaveBeenCalledTimes(1);
  });

  it("emits clean-build when Clean build is clicked", async () => {
    const el = await mount();
    const onClean = vi.fn();
    el.addEventListener("clean-build", onClean);
    const [, clean] = await openMenu(el);
    clean.click();
    expect(onClean).toHaveBeenCalledTimes(1);
  });

  it("disables Clean build while a build is running", async () => {
    const el = await mount(true);
    const onClean = vi.fn();
    el.addEventListener("clean-build", onClean);
    const [logs, clean] = await openMenu(el);
    expect(clean.classList.contains("menu-item--disabled")).toBe(true);
    expect(clean.getAttribute("aria-disabled")).toBe("true");
    // Out of the tab order and no keyboard activation while disabled.
    expect(clean.getAttribute("tabindex")).toBe("-1");
    clean.click();
    clean.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
    );
    expect(onClean).not.toHaveBeenCalled();
    // Logs stays live even while busy.
    const onLogs = vi.fn();
    el.addEventListener("open-logs", onLogs);
    logs.click();
    expect(onLogs).toHaveBeenCalledTimes(1);
  });

  it("closes after an item is chosen", async () => {
    const el = await mount();
    const [logs] = await openMenu(el);
    logs.click();
    await el.updateComplete;
    expect(items(el)).toHaveLength(0);
  });
});
