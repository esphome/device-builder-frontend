/**
 * @vitest-environment happy-dom
 *
 * A new web.esphome.io family needs no edits in the shared shell: with a
 * test-only family added to the registry, the header offers it, the mode URL
 * carries its flag, and the dashboard shows its card and intro.
 */
import { html } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/web/platforms/esp/esphome-web-esp-connect-card.js", () => ({}));
vi.mock("../../../src/web/platforms/rp2/esphome-web-pico-connect-card.js", () => ({}));
vi.mock("../../../src/web/platforms/nrf52/esphome-web-nrf-card.js", () => ({}));
vi.mock("../../../src/web/platforms/rtl87xx/esphome-web-rtl-card.js", () => ({}));
vi.mock("../../../src/web/dashboard/esphome-web-unsupported-card.js", () => ({}));
vi.mock("../../../src/util/register-icons.js", () => ({ registerMdiIcons: vi.fn() }));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("../../../src/util/web-serial.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isWebSerialSupported: () => true,
}));
vi.mock("../../../src/web/platforms/registry.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/web/platforms/registry.js")>();
  const fake = {
    mode: "testonly",
    logo: "testonly.svg",
    labelKey: "test.mode_label",
    introKey: "test.intro",
    renderCard: () => html`<span class="test-only-card"></span>`,
  };
  const platforms = [...actual.WEB_PLATFORMS, fake];
  return {
    ...actual,
    WEB_PLATFORMS: platforms,
    webPlatform: (mode: string) => platforms.find((p) => p.mode === mode) ?? platforms[0],
  };
});

import { ESPHomeWebDashboard } from "../../../src/web/dashboard/esphome-web-dashboard.js";
import { ESPHomeWebHeader } from "../../../src/web/header/esphome-web-header.js";
import { modeUrl, readMode, type WebMode } from "../../../src/web/web-mode.js";

// The test-only family isn't in the real WebMode union.
const TEST_ONLY = "testonly" as WebMode;

async function mount<T extends HTMLElement & { updateComplete: Promise<boolean> }>(
  el: T
): Promise<T> {
  Object.assign(el, { _localize: (k: string) => k, mode: TEST_ONLY });
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

let hadSerial = false;
beforeEach(() => {
  hadSerial = "serial" in navigator;
  if (!hadSerial) {
    Object.defineProperty(navigator, "serial", { value: {}, configurable: true });
  }
});

afterEach(() => {
  document.body.innerHTML = "";
  if (!hadSerial) Reflect.deleteProperty(navigator, "serial");
});

describe("a family added only to the web registry", () => {
  it("gets its own flag in the mode URL", () => {
    expect(readMode("?testonly")).toBe(TEST_ONLY);
    expect(modeUrl(TEST_ONLY, new URL("https://web.esphome.io/"))).toBe("/?testonly");
  });

  it("gets a header button with its logo and label, pressed when active", async () => {
    const header = await mount(new ESPHomeWebHeader());
    const buttons = [...header.shadowRoot!.querySelectorAll("button.mode-btn")];
    const last = buttons[buttons.length - 1];
    expect(last.getAttribute("aria-label")).toBe("test.mode_label");
    expect(last.getAttribute("aria-pressed")).toBe("true");
    expect(last.querySelector("img")?.getAttribute("src")).toBe(
      "/static/logo/testonly.svg"
    );
  });

  it("gets its card and intro on the dashboard", async () => {
    const dashboard = await mount(new ESPHomeWebDashboard());
    const root = dashboard.shadowRoot!;
    expect(root.querySelector(".test-only-card")).not.toBeNull();
    expect(root.textContent).toContain("test.intro");
  });
});
