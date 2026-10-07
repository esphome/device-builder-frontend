// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

// Connect cards drag in the whole serial/improv stack — only their custom-element
// registration matters for rendering the dashboard shell.
vi.mock("../../src/web/platforms/esp/esphome-web-esp-connect-card.js", () => ({}));
vi.mock("../../src/web/platforms/rp2/esphome-web-pico-connect-card.js", () => ({}));
vi.mock("../../src/web/platforms/nrf52/esphome-web-nrf-card.js", () => ({}));
vi.mock("../../src/web/dashboard/libretiny-card-element.js", () => ({}));
vi.mock("../../src/web/dashboard/esphome-web-unsupported-card.js", () => ({}));
vi.mock("../../src/util/web-serial.js", () => ({ isWebSerialSupported: () => true }));

import { ESPHomeWebDashboard } from "../../src/web/dashboard/esphome-web-dashboard.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

function setSearch(query: string): void {
  window.history.replaceState({}, "", query ? `/?${query}` : "/");
}

async function mount(
  mode: "esp" | "pico" | "rtl" | "bk" | "ln" = "esp"
): Promise<ESPHomeWebDashboard> {
  const el = new ESPHomeWebDashboard();
  (el as any)._localize = (k: string) => k;
  el.mode = mode;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function hintText(el: ESPHomeWebDashboard): string | null {
  return el.shadowRoot!.querySelector(".hint")?.textContent?.trim() ?? null;
}

afterEach(() => {
  document.body.innerHTML = "";
  setSearch("");
  vi.clearAllMocks();
});

describe("esphome-web-dashboard deep-link hint", () => {
  it("renders the hint from the current query and refreshes on navigation", async () => {
    setSearch("dashboard_logs");
    const el = await mount("esp");
    expect(hintText(el)).toContain("web.dashboard_hint.logs");

    // A back/forward navigation that changes the query recomputes the hint.
    setSearch("dashboard_install");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await el.updateComplete;
    expect(hintText(el)).toContain("web.dashboard_hint.install");

    // Query cleared → no hint (no stale banner).
    setSearch("");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".hint")).toBeNull();
  });

  it("does not show the hint in Pico mode (ESP-only actions)", async () => {
    setSearch("dashboard_logs");
    const el = await mount("pico");
    expect(el.shadowRoot!.querySelector(".hint")).toBeNull();
  });
});

// The LibreTiny families share one card, told its family.
describe.each([
  ["BK72xx", "bk"],
  ["LN882H", "ln"],
  ["RTL", "rtl"],
] as const)("esphome-web-dashboard %s mode", (_name, mode) => {
  it("renders the family's card and its intro", async () => {
    const el = await mount(mode);
    const card = el.shadowRoot!.querySelector("esphome-web-libretiny-card")!;
    expect(card.card.copy.title).toBe(`web.${mode}.title`);
    expect(el.shadowRoot!.textContent).toContain(`web.intro.body_${mode}`);
  });
});
