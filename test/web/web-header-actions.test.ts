/**
 * @vitest-environment happy-dom
 *
 * The ESPHome Web header kebab: opens on click, its single row is an anchor
 * pointing at the web.esphome.io issue form, and clicking the row closes the
 * menu.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/util/register-icons.js", () => ({ registerMdiIcons: vi.fn() }));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeWebHeaderActions } from "../../src/web/header/esphome-web-header-actions.js";
import { identityLocalize } from "../_dom.js";

afterEach(() => {
  document.body.innerHTML = "";
});

async function mount(): Promise<ESPHomeWebHeaderActions> {
  const el = new ESPHomeWebHeaderActions();
  (el as unknown as { _localize: typeof identityLocalize })._localize = identityLocalize;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

async function openMenu(el: ESPHomeWebHeaderActions): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>(".menu-btn")!.click();
  await el.updateComplete;
}

describe("esphome-web-header-actions", () => {
  it("opens the menu with a report-issue link targeting the web issue form", async () => {
    const el = await mount();
    expect(el.shadowRoot!.querySelector(".menu")).toBeNull();

    await openMenu(el);

    const link = el.shadowRoot!.querySelector<HTMLAnchorElement>(".menu-item--link");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe(
      "https://github.com/esphome/device-builder-frontend/issues/new?template=web_bug_report.yml"
    );
    expect(link!.getAttribute("target")).toBe("_blank");
    expect(link!.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link!.textContent).toContain("web.header.report_issue");
  });

  it("closes the menu when the report-issue link is clicked", async () => {
    const el = await mount();
    await openMenu(el);

    // happy-dom would follow the navigation; the assertion is about _close.
    const link = el.shadowRoot!.querySelector<HTMLAnchorElement>(".menu-item--link")!;
    link.addEventListener("click", (e) => e.preventDefault());
    link.click();
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector(".menu")).toBeNull();
  });

  it("closes the menu on backdrop click", async () => {
    const el = await mount();
    await openMenu(el);

    el.shadowRoot!.querySelector<HTMLElement>(".backdrop")!.click();
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector(".menu")).toBeNull();
  });
});
