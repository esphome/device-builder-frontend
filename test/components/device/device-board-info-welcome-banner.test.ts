/**
 * @vitest-environment happy-dom
 *
 * The just-created welcome banner tells the user the first install
 * needs a USB cable and offers an Install now button that asks the
 * page to open the install-method picker.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/badge/badge.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/callout/callout.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("../../../src/components/device/add-automation-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-component-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-config-dialog.js", () => ({}));
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

import type { BoardCatalogEntry } from "../../../src/api/types/boards.js";
import { ESPHomeDeviceBoardInfo } from "../../../src/components/device/device-board-info.js";

async function mountJustCreated(): Promise<ESPHomeDeviceBoardInfo> {
  const el = new ESPHomeDeviceBoardInfo();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._localize = (key: string) => key;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._api = {};
  el.board = {
    id: "esp32dev",
    name: "ESP32 DevKit",
    description: "",
    tags: [],
    images: [],
    esphome: { platform: "esp32" },
  } as unknown as BoardCatalogEntry;
  el.justCreated = true;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("device-board-info welcome banner", () => {
  it("mentions the USB first install", async () => {
    const el = await mountJustCreated();
    const banner = el.shadowRoot!.querySelector(".welcome-banner")!;
    expect(banner.textContent).toContain("device.welcome_banner_first_install");
  });

  it("emits request-install from the Install now button", async () => {
    const el = await mountJustCreated();
    const seen = vi.fn();
    el.addEventListener("request-install", seen);
    const button = el.shadowRoot!.querySelector<HTMLButtonElement>(
      ".welcome-banner-install"
    )!;
    expect(button.textContent).toContain("device.welcome_banner_install_button");
    button.click();
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
