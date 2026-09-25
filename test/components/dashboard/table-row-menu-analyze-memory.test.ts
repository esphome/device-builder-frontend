/**
 * @vitest-environment happy-dom
 *
 * The kebab menu offers "Analyze memory" only in Expert Mode; the item emits
 * analyze-memory and is inert while the device has a job running.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { findMenuItem, mount } from "../../_dom.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";
import { ESPHomeTableRowMenu } from "../../../src/components/dashboard/table-row-menu.js";

const LABEL = "dashboard.action_analyze_memory";
const expert = { _expertMode: true } as Partial<ESPHomeTableRowMenu>;

describe("table-row-menu analyze-memory item", () => {
  it("is hidden unless Expert Mode is on", async () => {
    const el = await mount(new ESPHomeTableRowMenu(), {
      device: makeConfiguredDevice(),
      position: { x: 10, y: 10 },
    });
    expect(findMenuItem(el, LABEL)).toBeUndefined();
  });

  it("emits analyze-memory in Expert Mode", async () => {
    const el = await mount(new ESPHomeTableRowMenu(), {
      device: makeConfiguredDevice(),
      position: { x: 10, y: 10 },
      ...expert,
    });
    const item = findMenuItem(el, LABEL);
    expect(item).toBeDefined();

    const emitted = vi.fn();
    el.addEventListener("analyze-memory", emitted);
    item!.click();
    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it("is disabled while the device is busy", async () => {
    const el = await mount(new ESPHomeTableRowMenu(), {
      device: makeConfiguredDevice(),
      position: { x: 10, y: 10 },
      busy: true,
      ...expert,
    });
    const item = findMenuItem(el, LABEL)!;
    expect(item.classList.contains("menu-item--disabled")).toBe(true);

    const emitted = vi.fn();
    el.addEventListener("analyze-memory", emitted);
    item.click();
    expect(emitted).not.toHaveBeenCalled();
  });
});
