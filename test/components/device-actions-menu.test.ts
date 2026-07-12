/**
 * @vitest-environment happy-dom
 *
 * Pins the editor actions menu's Visit-web-UI item: present only when the
 * page passed a web-UI URL (web_server compiled in + host known), rendered
 * as the shared secure anchor, and closing the menu on activation.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeDeviceActionsMenu } from "../../src/components/device/device-actions-menu.js";

async function mount(webUiUrl = ""): Promise<ESPHomeDeviceActionsMenu> {
  const el = new ESPHomeDeviceActionsMenu();
  el.webUiUrl = webUiUrl;
  document.body.appendChild(el);
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>(".menu-btn")!.click();
  await el.updateComplete;
  return el;
}

function link(el: ESPHomeDeviceActionsMenu): HTMLAnchorElement | null {
  return el.shadowRoot!.querySelector<HTMLAnchorElement>(".menu-item--link");
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("device actions menu Visit web UI", () => {
  it("omits the item without a URL", async () => {
    const el = await mount();
    expect(el.shadowRoot!.querySelector(".menu")).not.toBeNull();
    expect(link(el)).toBeNull();
  });

  it("renders the secure anchor when a URL is set", async () => {
    const el = await mount("http://kitchen.local/");
    const a = link(el)!;
    expect(a).not.toBeNull();
    expect(a.getAttribute("href")).toBe("http://kitchen.local/");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.textContent).toContain("dashboard.action_visit_web_ui");
  });

  it("closes the menu when the link is activated", async () => {
    const el = await mount("http://kitchen.local/");
    // Block the real navigation; the menu's own click handling still runs.
    el.shadowRoot!.addEventListener("click", (e) => e.preventDefault(), true);
    link(el)!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".menu")).toBeNull();
  });

  it("appears live when the URL arrives after first render", async () => {
    const el = await mount();
    el.webUiUrl = "http://kitchen.local/";
    await el.updateComplete;
    expect(link(el)).not.toBeNull();
  });
});
