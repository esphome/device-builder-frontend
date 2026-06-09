/**
 * @vitest-environment happy-dom
 *
 * Pins the navigator search reveal behavior: the box hides behind a
 * header magnifier on short configs, auto-expands (no magnifier) once the
 * item count crosses the threshold, and toggling closed clears the query.
 * Dialog children are no-oped so the element constructs in happy-dom; see
 * ``device-navigator-coalesce.test.ts``.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/components/device/add-automation-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-component-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-config-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-script-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeDeviceNavigator } from "../../../src/components/device/device-navigator.js";

const SMALL_YAML = ["esphome:", "  name: t", "wifi:", "logger:", ""].join("\n");

const LARGE_YAML = [
  "esphome:",
  "  name: t",
  "sensor:",
  ...Array.from({ length: 30 }, (_, i) =>
    [`  - platform: template`, `    name: "S${i}"`, `    id: s${i}`].join("\n")
  ),
  "",
].join("\n");

async function mountNavigator(yaml: string): Promise<ESPHomeDeviceNavigator> {
  const nav = new ESPHomeDeviceNavigator();
  nav.yaml = yaml;
  nav.openSections = new Set([0, 1, 2]);
  document.body.appendChild(nav);
  await nav.updateComplete;
  return nav;
}

const searchBox = (nav: ESPHomeDeviceNavigator) =>
  nav.shadowRoot!.querySelector("esphome-navigator-search")!;
const searchBtn = (nav: ESPHomeDeviceNavigator) =>
  nav.shadowRoot!.querySelector<HTMLButtonElement>(".search-btn");

afterEach(() => {
  document.body.innerHTML = "";
});

describe("navigator search reveal", () => {
  it("hides the box behind the magnifier on a short config", async () => {
    const nav = await mountNavigator(SMALL_YAML);
    expect(searchBox(nav).hasAttribute("hidden")).toBe(true);
    expect(searchBtn(nav)).not.toBeNull();
  });

  it("reveals the box when the magnifier is clicked", async () => {
    const nav = await mountNavigator(SMALL_YAML);
    searchBtn(nav)!.click();
    await nav.updateComplete;
    expect(searchBox(nav).hasAttribute("hidden")).toBe(false);
  });

  it("toggling closed clears an active query", async () => {
    const nav = await mountNavigator(SMALL_YAML);
    searchBox(nav).dispatchEvent(
      new CustomEvent("navigator-search", {
        detail: { value: "wifi" },
        bubbles: true,
        composed: true,
      })
    );
    await nav.updateComplete;
    expect(searchBox(nav).hasAttribute("hidden")).toBe(false);

    searchBtn(nav)!.click();
    await nav.updateComplete;
    expect(searchBox(nav).hasAttribute("hidden")).toBe(true);
    expect((searchBox(nav) as { value: string }).value).toBe("");
  });

  it("auto-expands without a magnifier past the threshold", async () => {
    const nav = await mountNavigator(LARGE_YAML);
    expect(searchBox(nav).hasAttribute("hidden")).toBe(false);
    expect(searchBtn(nav)).toBeNull();
  });
});
