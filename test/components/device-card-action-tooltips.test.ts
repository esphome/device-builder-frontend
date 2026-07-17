/**
 * @vitest-environment happy-dom
 *
 * Icon-only card actions carry a ``wa-tooltip`` anchored by id instead of a
 * native ``title``, so hover names the action in the design-system style.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/tooltip/tooltip.js", () => ({}));

import { mountDeviceCard as mount } from "./_device-card.js";

function tooltipFor(el: HTMLElement, id: string): Element | null {
  return el.shadowRoot!.querySelector(`wa-tooltip[for="${id}"]`);
}

describe("device-card action tooltips", () => {
  it("anchors a tooltip to the logs button and drops the native title", async () => {
    const el = await mount({});
    const button = el.shadowRoot!.querySelector("#btn-logs")!;
    expect(button.hasAttribute("title")).toBe(false);
    expect(tooltipFor(el, "btn-logs")!.textContent).toContain("dashboard.drawer_logs");
  });

  it("anchors a tooltip to the more-options button", async () => {
    const el = await mount({});
    expect(tooltipFor(el, "btn-more")!.textContent).toContain("dashboard.more_options");
  });

  it("names the install action on the accent button", async () => {
    const el = await mount({ showModified: true });
    const button = el.shadowRoot!.querySelector("#btn-accent")!;
    expect(button.hasAttribute("title")).toBe(false);
    expect(tooltipFor(el, "btn-accent")!.textContent).toContain("dashboard.install");
  });

  it("names the update action on the accent button", async () => {
    const el = await mount({ showUpdate: true });
    expect(tooltipFor(el, "btn-accent")!.textContent).toContain("dashboard.update");
  });

  it("anchors a tooltip to the web UI link and drops its native title", async () => {
    const el = await mount({ webUrl: "http://device.local" });
    const link = el.shadowRoot!.querySelector("#btn-web-ui")!;
    expect(link.hasAttribute("title")).toBe(false);
    expect(tooltipFor(el, "btn-web-ui")!.textContent).toContain(
      "dashboard.action_visit_web_ui"
    );
  });

  it("renders no orphan web UI tooltip without a web url", async () => {
    const el = await mount({});
    expect(tooltipFor(el, "btn-web-ui")).toBeNull();
  });
});
