/**
 * @vitest-environment happy-dom
 *
 * The kebab menu offers "Analyze memory" only in Expert Mode; the item emits
 * analyze-memory and is inert while the device has a job running.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { mount } from "../../_dom.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";
import { ESPHomeTableRowMenu } from "../../../src/components/dashboard/table-row-menu.js";
import { findMenuItem } from "./_row-menu.js";

function findAnalyzeItem(el: ESPHomeTableRowMenu): Element | undefined {
  return findMenuItem(el, "dashboard.action_analyze_memory");
}

async function mountMenu(opts: { expertMode: boolean; busy?: boolean }) {
  return mount(new ESPHomeTableRowMenu(), {
    device: makeConfiguredDevice(),
    position: { x: 10, y: 10 },
    busy: opts.busy ?? false,
    ...({ _expertMode: opts.expertMode } as Partial<ESPHomeTableRowMenu>),
  });
}

describe("table-row-menu analyze-memory item", () => {
  it("is hidden unless Expert Mode is on", async () => {
    const el = await mountMenu({ expertMode: false });
    expect(findAnalyzeItem(el)).toBeUndefined();
  });

  it("emits analyze-memory in Expert Mode", async () => {
    const el = await mountMenu({ expertMode: true });
    const item = findAnalyzeItem(el);
    expect(item).toBeDefined();

    const emitted = vi.fn();
    el.addEventListener("analyze-memory", emitted);
    (item as HTMLElement).click();
    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it("is disabled while the device is busy", async () => {
    const el = await mountMenu({ expertMode: true, busy: true });
    const item = findAnalyzeItem(el)!;
    expect(item.classList.contains("menu-item--disabled")).toBe(true);

    const emitted = vi.fn();
    el.addEventListener("analyze-memory", emitted);
    (item as HTMLElement).click();
    expect(emitted).not.toHaveBeenCalled();
  });
});
