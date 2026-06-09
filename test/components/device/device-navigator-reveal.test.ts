/**
 * @vitest-environment happy-dom
 *
 * Pins the navigator "reveal selected" behavior: an externally-driven
 * selection (YAML cursor) expands the collapsed section that holds the row
 * and scrolls the row into view, without re-scrolling on idle re-renders.
 * Dialog children are no-oped so the element constructs in happy-dom; see
 * device-navigator-filter.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/components/device/add-automation-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-component-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-config-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-script-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeDeviceNavigator } from "../../../src/components/device/device-navigator.js";
import { deriveNavigatorBuckets } from "../../../src/components/device/navigator-buckets.js";
import { sectionIndexForLine } from "../../../src/components/device/navigator-reveal-controller.js";
import {
  parseYamlTopLevelSections,
  sectionKeyOf,
} from "../../../src/util/yaml-sections.js";

const YAML = [
  "esphome:",
  "  name: t",
  "wifi:",
  "sensor:",
  "  - platform: template",
  '    name: "Living Temp"',
  "    id: living_temp",
  "",
].join("\n");

/** fromLine of the sensor.template row (lives in the Components section). */
const sensorLine = () => {
  const s = parseYamlTopLevelSections(YAML).find(
    (sec) => sectionKeyOf(sec) === "sensor.template"
  );
  if (!s) throw new Error("fixture: sensor.template not found");
  return s.fromLine;
};

let scrollSpy: ReturnType<typeof vi.fn>;
let originalScrollIntoView: typeof Element.prototype.scrollIntoView;

beforeEach(() => {
  originalScrollIntoView = Element.prototype.scrollIntoView;
  scrollSpy = vi.fn();
  // happy-dom doesn't implement scrollIntoView; install a spy to assert on.
  Element.prototype.scrollIntoView = scrollSpy as typeof Element.prototype.scrollIntoView;
});

afterEach(() => {
  document.body.innerHTML = "";
  // Direct prototype assignment isn't a vi.spyOn, so restore it explicitly.
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

async function mount(openSections: Set<number>): Promise<{
  nav: ESPHomeDeviceNavigator;
  reveals: number[];
}> {
  const nav = new ESPHomeDeviceNavigator();
  nav.yaml = YAML;
  nav.openSections = openSections;
  const reveals: number[] = [];
  nav.addEventListener("section-reveal", (e) => {
    reveals.push((e as CustomEvent<{ index: number }>).detail.index);
  });
  document.body.appendChild(nav);
  await nav.updateComplete;
  return { nav, reveals };
}

describe("sectionIndexForLine", () => {
  it("maps a line to its bucket (core/components/automations)", () => {
    const buckets = deriveNavigatorBuckets(YAML);
    expect(sectionIndexForLine(buckets, buckets.core[0].fromLine)).toBe(0);
    expect(sectionIndexForLine(buckets, buckets.components[0].fromLine)).toBe(1);
    expect(sectionIndexForLine(buckets, 9999)).toBe(-1);
  });
});

describe("device-navigator reveal-selected", () => {
  it("expands the collapsed section, then scrolls the row into view", async () => {
    const { nav, reveals } = await mount(new Set());

    nav.selectedKey = "sensor.template";
    nav.selectedFromLine = sensorLine();
    await nav.updateComplete;

    // Components is section index 1; collapsed, so it asks the page to open it.
    expect(reveals).toEqual([1]);
    expect(scrollSpy).not.toHaveBeenCalled();

    // Page opens it (accordion). Now the row mounts and we scroll to it.
    nav.openSections = new Set([1]);
    await nav.updateComplete;

    const row = nav.shadowRoot!.querySelector(".nav-item--selected");
    expect(row).toBeTruthy();
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy.mock.instances[0]).toBe(row);
  });

  it("scrolls without asking to open when the section is already open", async () => {
    const { nav, reveals } = await mount(new Set([1]));

    nav.selectedKey = "sensor.template";
    nav.selectedFromLine = sensorLine();
    await nav.updateComplete;

    expect(reveals).toEqual([]);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  it("does not re-scroll on an idle re-render", async () => {
    const { nav } = await mount(new Set([1]));
    nav.selectedKey = "sensor.template";
    nav.selectedFromLine = sensorLine();
    await nav.updateComplete;
    expect(scrollSpy).toHaveBeenCalledTimes(1);

    // A re-render that doesn't change the selection (e.g. hover) must not rescroll.
    nav.requestUpdate();
    await nav.updateComplete;
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  // A Components row inside a collapsed domain subgroup isn't rendered even
  // when its section is open; the controller must not latch on that empty
  // render, so it retries once the subgroup expands and the row mounts.
  it("retries the scroll after a collapsed subgroup is expanded", async () => {
    const { nav } = await mount(new Set([1]));
    const sensorGroup = () =>
      [...nav.shadowRoot!.querySelectorAll(".nav-subgroup-header")].find((h) =>
        h.querySelector(".nav-subgroup-title")?.textContent?.includes("Sensor")
      ) as HTMLElement;

    // Collapse the Sensor subgroup, then select the sensor row it hides.
    sensorGroup().click();
    await nav.updateComplete;
    nav.selectedKey = "sensor.template";
    nav.selectedFromLine = sensorLine();
    await nav.updateComplete;
    expect(nav.shadowRoot!.querySelector(".nav-item--selected")).toBeNull();
    expect(scrollSpy).not.toHaveBeenCalled();

    // Expand it: the row mounts and the deferred scroll fires.
    sensorGroup().click();
    await nav.updateComplete;
    expect(nav.shadowRoot!.querySelector(".nav-item--selected")).toBeTruthy();
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  // The page renders two navigators (drawer + desktop) sharing one
  // openSections. A toggle would race them open/closed forever and hang the
  // page; section-reveal is an idempotent set, so it converges.
  it("converges with two navigators sharing openSections (no oscillation)", async () => {
    let shared = new Set<number>();
    let reveals = 0;
    const navs: ESPHomeDeviceNavigator[] = [];
    // Mimic the page handler: idempotent open, applied to both navigators.
    // Scoped to an AbortController so the document listener doesn't leak.
    const controller = new AbortController();
    document.addEventListener(
      "section-reveal",
      (e) => {
        reveals++;
        if (reveals > 30) return; // safety net: a regression would loop here
        const idx = (e as CustomEvent<{ index: number }>).detail.index;
        if (shared.has(idx)) return;
        shared = new Set([idx]);
        for (const n of navs) n.openSections = shared;
      },
      { signal: controller.signal }
    );

    try {
      for (let i = 0; i < 2; i++) {
        const n = new ESPHomeDeviceNavigator();
        n.yaml = YAML;
        n.openSections = shared;
        document.body.appendChild(n);
        navs.push(n);
      }
      await Promise.all(navs.map((n) => n.updateComplete));

      for (const n of navs) {
        n.selectedKey = "sensor.template";
        n.selectedFromLine = sensorLine();
      }
      // Let the open → re-render → scroll settle across both instances.
      for (let i = 0; i < 5; i++) await Promise.all(navs.map((n) => n.updateComplete));

      expect(reveals).toBeLessThan(10); // converged, nowhere near the safety net
      expect(shared.has(1)).toBe(true); // Components ended open
      expect(scrollSpy).toHaveBeenCalled();
    } finally {
      controller.abort();
    }
  });
});
