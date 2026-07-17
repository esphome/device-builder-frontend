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

describe("device-card indicator tooltips", () => {
  it("names the modified dot", async () => {
    const el = await mount({ showModified: true });
    const dot = el.shadowRoot!.querySelector("#ind-modified")!;
    expect(dot.hasAttribute("title")).toBe(false);
    expect(dot.getAttribute("tabindex")).toBe("0");
    expect(dot.getAttribute("role")).toBe("img");
    expect(dot.getAttribute("aria-label")).toBe("dashboard.status_modified");
    expect(tooltipFor(el, "ind-modified")!.textContent).toContain(
      "dashboard.status_modified"
    );
  });

  it("names the update dot", async () => {
    const el = await mount({ showUpdate: true });
    expect(tooltipFor(el, "ind-update")!.textContent).toContain(
      "dashboard.status_update_available"
    );
  });

  it("names the queued-update clock", async () => {
    const el = await mount({ queuedUpdate: true });
    expect(tooltipFor(el, "ind-queued")!.textContent).toContain(
      "dashboard.status_queued_update"
    );
  });

  it("names the encryption indicator with its state tooltip", async () => {
    const el = await mount({
      hasPendingChanges: true,
      apiEnabled: true,
      apiEncrypted: true,
      apiEncryptionActive: null,
    });
    const icon = el.shadowRoot!.querySelector("#ind-encryption")!;
    expect(icon.hasAttribute("title")).toBe(false);
    expect(icon.getAttribute("aria-label")).toBe(
      "dashboard.table_status_encryption_pending_tooltip"
    );
    expect(tooltipFor(el, "ind-encryption")!.textContent).toContain(
      "dashboard.table_status_encryption_pending_tooltip"
    );
  });

  it("gives every focusable indicator an accessible name", async () => {
    const el = await mount({ showUpdate: true, queuedUpdate: true });
    for (const id of ["ind-update", "ind-queued"]) {
      const node = el.shadowRoot!.querySelector(`#${id}`)!;
      expect(node.getAttribute("role")).toBe("img");
      expect(node.getAttribute("aria-label")).toBeTruthy();
    }
  });
});
