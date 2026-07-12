// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/util/register-icons.js", () => ({ registerMdiIcons: vi.fn() }));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeWebHeader } from "../../src/web/header/esphome-web-header.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

// The switch button only renders when Web Serial is available; happy-dom has no
// navigator.serial, so define one for the duration of these tests.
let hadSerial = false;
beforeEach(() => {
  hadSerial = "serial" in navigator;
  if (!hadSerial) {
    Object.defineProperty(navigator, "serial", { value: {}, configurable: true });
  }
});

afterEach(() => {
  document.body.innerHTML = "";
  if (!hadSerial) {
    delete (navigator as any).serial;
  }
});

async function mount(mode: "esp" | "pico", minimal = false): Promise<ESPHomeWebHeader> {
  const el = new ESPHomeWebHeader();
  (el as any)._localize = (k: string) => k;
  el.mode = mode;
  el.minimal = minimal;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("esphome-web-header switch target", () => {
  it("targets Pico when the current mode is ESP", async () => {
    const el = await mount("esp");

    const btn = el.shadowRoot!.querySelector(".switch-btn");
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute("aria-label")).toBe("web.header.switch_to_pico");
    const logo = el.shadowRoot!.querySelector<HTMLImageElement>(".target-logo");
    expect(logo!.getAttribute("src")).toContain("raspberry");
  });

  it("targets ESP when the current mode is Pico", async () => {
    const el = await mount("pico");

    const btn = el.shadowRoot!.querySelector(".switch-btn");
    expect(btn!.getAttribute("aria-label")).toBe("web.header.switch_to_esp");
    const logo = el.shadowRoot!.querySelector<HTMLImageElement>(".target-logo");
    expect(logo!.getAttribute("src")).toContain("espressif");
  });

  it("hides the switch in minimal (flash-receiver) mode", async () => {
    const el = await mount("esp", true);

    expect(el.shadowRoot!.querySelector(".switch-btn")).toBeNull();
  });
});
