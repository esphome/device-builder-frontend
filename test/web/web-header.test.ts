// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/util/register-icons.js", () => ({ registerMdiIcons: vi.fn() }));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeWebHeader } from "../../src/web/header/esphome-web-header.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

// The mode picker only renders when Web Serial is available; happy-dom has no
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

async function mount(
  mode: "esp" | "pico" | "nrf" | "rtl",
  minimal = false
): Promise<ESPHomeWebHeader> {
  const el = new ESPHomeWebHeader();
  (el as any)._localize = (k: string) => k;
  el.mode = mode;
  el.minimal = minimal;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("esphome-web-header mode picker", () => {
  it("renders four mode buttons", async () => {
    const el = await mount("esp");
    const btns = el.shadowRoot!.querySelectorAll(".mode-btn");
    expect(btns.length).toBe(4);
  });

  it("marks ESP as active when mode is esp", async () => {
    const el = await mount("esp");
    const btns = [...el.shadowRoot!.querySelectorAll(".mode-btn")];
    expect(btns[0].classList.contains("active")).toBe(true);
    expect(btns[1].classList.contains("active")).toBe(false);
    expect(btns[2].classList.contains("active")).toBe(false);
  });

  it("marks Pico as active when mode is pico", async () => {
    const el = await mount("pico");
    const btns = [...el.shadowRoot!.querySelectorAll(".mode-btn")];
    expect(btns[0].classList.contains("active")).toBe(false);
    expect(btns[1].classList.contains("active")).toBe(true);
    expect(btns[2].classList.contains("active")).toBe(false);
  });

  it("marks nRF as active when mode is nrf", async () => {
    const el = await mount("nrf");
    const btns = [...el.shadowRoot!.querySelectorAll(".mode-btn")];
    expect(btns[0].classList.contains("active")).toBe(false);
    expect(btns[1].classList.contains("active")).toBe(false);
    expect(btns[2].classList.contains("active")).toBe(true);
  });

  it("shows espressif, raspberry and nordic logos in order", async () => {
    const el = await mount("esp");
    const logos = [...el.shadowRoot!.querySelectorAll<HTMLImageElement>(".mode-logo")];
    expect(logos[0].src).toContain("espressif");
    expect(logos[1].src).toContain("raspberry");
    expect(logos[2].src).toContain("nordic");
  });

  it("names every mode button for screen readers (labels hide below 870px)", async () => {
    const el = await mount("esp");
    const btns = [...el.shadowRoot!.querySelectorAll(".mode-btn")];
    expect(btns.map((b) => b.getAttribute("aria-label"))).toEqual([
      "web.header.mode_esp",
      "web.header.mode_pico",
      "web.header.mode_nrf",
      "web.header.mode_rtl",
    ]);
    expect(el.shadowRoot!.querySelector(".mode-picker")!.getAttribute("aria-label")).toBe(
      "web.header.mode_picker_label"
    );
  });

  it("dispatches set-mode with the clicked mode", async () => {
    const el = await mount("esp");
    const btns = [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".mode-btn")];
    const events: string[] = [];
    el.addEventListener("set-mode", (e) => events.push((e as CustomEvent).detail));
    btns[1].click(); // Pico
    expect(events).toEqual(["pico"]);
  });

  it("hides the picker in minimal (flash-receiver) mode", async () => {
    const el = await mount("esp", true);
    expect(el.shadowRoot!.querySelector(".mode-picker")).toBeNull();
  });

  it("keeps the kebab in minimal (flash-receiver) mode", async () => {
    const el = await mount("esp", true);
    expect(el.shadowRoot!.querySelector("esphome-web-header-actions")).not.toBeNull();
  });
});
