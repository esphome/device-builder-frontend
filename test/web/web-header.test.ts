// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/util/register-icons.js", () => ({ registerMdiIcons: vi.fn() }));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeWebHeader } from "../../src/web/header/esphome-web-header.js";
import { WEB_PLATFORMS } from "../../src/web/platforms/registry.js";
import type { WebMode } from "../../src/web/web-mode.js";

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

async function mount(mode: WebMode, minimal = false): Promise<ESPHomeWebHeader> {
  const el = new ESPHomeWebHeader();
  (el as any)._localize = (k: string) => k;
  el.mode = mode;
  el.minimal = minimal;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("esphome-web-header mode picker", () => {
  it("renders the family picker on the current mode", async () => {
    const el = await mount("rtl");
    const picker = el.shadowRoot!.querySelector("esphome-web-mode-picker");
    expect(picker).not.toBeNull();
    expect(picker!.mode).toBe("rtl");
  });

  it("names every family on a button where they fit, the current one pressed", async () => {
    const el = await mount("rtl");
    const btns = [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".mode-btn")];
    expect(btns.map((b) => b.textContent?.trim())).toEqual(
      WEB_PLATFORMS.map((p) => p.labelKey)
    );
    expect(btns.map((b) => b.getAttribute("aria-pressed"))).toEqual(
      WEB_PLATFORMS.map((p) => String(p.mode === "rtl"))
    );
  });

  it("switches family from a button", async () => {
    const el = await mount("esp");
    const picked: string[] = [];
    el.addEventListener("set-mode", (e) => picked.push((e as CustomEvent).detail));
    const last = WEB_PLATFORMS[WEB_PLATFORMS.length - 1];
    const btns = el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".mode-btn");
    btns[btns.length - 1].click();
    expect(picked).toEqual([last.mode]);
  });

  it("hides the buttons and the picker in minimal (flash-receiver) mode", async () => {
    const el = await mount("esp", true);
    expect(el.shadowRoot!.querySelector("esphome-web-mode-picker")).toBeNull();
    expect(el.shadowRoot!.querySelector(".mode-buttons")).toBeNull();
  });

  it("keeps the kebab in minimal (flash-receiver) mode", async () => {
    const el = await mount("esp", true);
    expect(el.shadowRoot!.querySelector("esphome-web-header-actions")).not.toBeNull();
  });
});
