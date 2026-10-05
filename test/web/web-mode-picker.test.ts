// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/util/register-icons.js", () => ({ registerMdiIcons: vi.fn() }));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeWebModePicker } from "../../src/web/header/esphome-web-mode-picker.js";
import { WEB_PLATFORMS } from "../../src/web/platforms/registry.js";
import type { WebMode } from "../../src/web/web-mode.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

afterEach(() => {
  document.body.innerHTML = "";
});

async function mount(mode: WebMode): Promise<ESPHomeWebModePicker> {
  const el = new ESPHomeWebModePicker();
  (el as any)._localize = (k: string) => k;
  el.mode = mode;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const root = (el: ESPHomeWebModePicker) => el.shadowRoot!;
const trigger = (el: ESPHomeWebModePicker) =>
  root(el).querySelector<HTMLButtonElement>(".trigger")!;
const rows = (el: ESPHomeWebModePicker) => [
  ...root(el).querySelectorAll<HTMLElement>(".menu-item"),
];

async function open(el: ESPHomeWebModePicker) {
  trigger(el).click();
  await el.updateComplete;
}

describe("esphome-web-mode-picker", () => {
  it("names the current family on the trigger, closed", async () => {
    const el = await mount("rtl");
    expect(trigger(el).textContent).toContain("web.header.mode_rtl");
    expect(trigger(el).getAttribute("aria-label")).toBe(
      "web.header.mode_picker_label: web.header.mode_rtl"
    );
    expect(trigger(el).getAttribute("aria-expanded")).toBe("false");
    expect(trigger(el).querySelector("img")!.getAttribute("src")).toBe(
      "/static/logo/rtl8720c.svg"
    );
    expect(root(el).querySelector(".menu")).toBeNull();
  });

  it("lists every family when opened, the current one checked and focused", async () => {
    const el = await mount("pico");
    await open(el);
    expect(trigger(el).getAttribute("aria-expanded")).toBe("true");
    expect(rows(el).map((r) => r.textContent!.trim())).toEqual(
      WEB_PLATFORMS.map((p) => p.labelKey)
    );
    expect(rows(el).map((r) => r.getAttribute("aria-checked"))).toEqual(
      WEB_PLATFORMS.map((p) => String(p.mode === "pico"))
    );
    expect(root(el).activeElement).toBe(
      rows(el)[WEB_PLATFORMS.findIndex((p) => p.mode === "pico")]
    );
  });

  it("fires set-mode with the picked family and closes", async () => {
    const el = await mount("esp");
    const events: string[] = [];
    el.addEventListener("set-mode", (e) => events.push((e as CustomEvent).detail));
    await open(el);
    const last = WEB_PLATFORMS[WEB_PLATFORMS.length - 1];
    rows(el)[WEB_PLATFORMS.length - 1].click();
    await el.updateComplete;
    expect(events).toEqual([last.mode]);
    expect(root(el).querySelector(".menu")).toBeNull();
  });

  it("only closes when the current family is picked again", async () => {
    const el = await mount("esp");
    const events: string[] = [];
    el.addEventListener("set-mode", (e) => events.push((e as CustomEvent).detail));
    await open(el);
    rows(el)[0].click();
    await el.updateComplete;
    expect(events).toEqual([]);
    expect(root(el).querySelector(".menu")).toBeNull();
  });

  it("closes on the backdrop and on Escape without picking", async () => {
    const el = await mount("esp");
    const events: string[] = [];
    el.addEventListener("set-mode", (e) => events.push((e as CustomEvent).detail));
    await open(el);
    root(el).querySelector<HTMLElement>(".backdrop")!.click();
    await el.updateComplete;
    expect(root(el).querySelector(".menu")).toBeNull();
    await open(el);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );
    await el.updateComplete;
    expect(root(el).querySelector(".menu")).toBeNull();
    expect(events).toEqual([]);
  });

  it("closes when the window resizes", async () => {
    const el = await mount("esp");
    await open(el);
    window.dispatchEvent(new Event("resize"));
    await el.updateComplete;
    expect(root(el).querySelector(".menu")).toBeNull();
  });

  it("hands focus back to the trigger however the menu closes", async () => {
    const el = await mount("esp");
    const trigger = () => root(el).querySelector<HTMLElement>(".trigger");
    const press = (key: string) =>
      (root(el).activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true })
      );
    await open(el);
    root(el).querySelector<HTMLElement>(".backdrop")!.click();
    await el.updateComplete;
    expect(root(el).activeElement).toBe(trigger());
    await open(el);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );
    await el.updateComplete;
    expect(root(el).activeElement).toBe(trigger());
    await open(el);
    press("Tab");
    await el.updateComplete;
    expect(root(el).querySelector(".menu")).toBeNull();
    expect(root(el).activeElement).toBe(trigger());
  });

  it("moves between families with the arrow keys and picks with Enter", async () => {
    const el = await mount("esp");
    const events: string[] = [];
    el.addEventListener("set-mode", (e) => events.push((e as CustomEvent).detail));
    await open(el);
    // A real key press comes from the focused row (the current family) and bubbles to the menu.
    (root(el).activeElement as HTMLElement).dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })
    );
    const last = rows(el).length - 1;
    expect(root(el).activeElement).toBe(rows(el)[last]);
    rows(el)[last].dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
    );
    expect(events).toEqual([WEB_PLATFORMS[last].mode]);
  });
});
