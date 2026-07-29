/**
 * @vitest-environment happy-dom
 *
 * The legacy-spelling banner nudges migration of renamed keys (api
 * services, homeassistant.service) and asks the page to canonicalize.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/badge/badge.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/callout/callout.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("../../../src/components/device/add-component-dialog.js", () => ({}));
vi.mock(
  "../../../src/components/device/automation-editor/api-action-editor.js",
  () => ({})
);
vi.mock(
  "../../../src/components/device/automation-editor/automation-editor.js",
  () => ({})
);
vi.mock("../../../src/components/device/automation-editor/script-editor.js", () => ({}));
vi.mock("../../../src/components/device/change-board-dialog.js", () => ({}));
vi.mock("../../../src/components/device/device-section-config.js", () => ({}));

import { ESPHomeDeviceBoardInfo } from "../../../src/components/device/device-board-info.js";

async function mount(yaml: string): Promise<ESPHomeDeviceBoardInfo> {
  const el = new ESPHomeDeviceBoardInfo();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._localize = (key: string) => key;
  el.yaml = yaml;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("device-board-info legacy-spelling banner", () => {
  it("renders when the buffer holds a legacy spelling", async () => {
    const el = await mount("api:\n  services:\n    - service: pause\n      then: []\n");
    const banner = el.shadowRoot!.querySelector(".legacy-spelling-banner")!;
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain("device.legacy_spelling_notice");
  });

  it("stays hidden for a canonical buffer", async () => {
    const el = await mount("api:\n  actions:\n    - action: pause\n      then: []\n");
    expect(el.shadowRoot!.querySelector(".legacy-spelling-banner")).toBeNull();
  });

  it("emits request-canonicalize from the Migrate button", async () => {
    const el = await mount(
      "esphome:\n  on_boot:\n    then:\n      - homeassistant.service:\n          action: light.on\n"
    );
    const seen = vi.fn();
    el.addEventListener("request-canonicalize", seen);
    el.shadowRoot!.querySelector(".legacy-spelling-banner")!
      .querySelector<HTMLButtonElement>(".cta")!
      .click();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("hides after dismiss until remount", async () => {
    const el = await mount(
      "esphome:\n  on_boot:\n    then:\n      - homeassistant.service:\n          action: light.on\n"
    );
    el.shadowRoot!.querySelector(".legacy-spelling-banner")!
      .querySelector<HTMLButtonElement>(".notice-close")!
      .click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".legacy-spelling-banner")).toBeNull();
  });
});
