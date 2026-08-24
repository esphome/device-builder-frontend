/**
 * @vitest-environment happy-dom
 *
 * The tile shows the device's ``esphome.comment`` under the filename;
 * a device without one renders no comment node.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/tooltip/tooltip.js", () => ({}));

import { mountDeviceCard as mount } from "./_device-card.js";

describe("device-card comment", () => {
  it("renders the comment under the configuration filename", async () => {
    const el = await mount({ comment: "Garage, behind the freezer" });
    const node = el.shadowRoot!.querySelector(".device-comment")!;
    expect(node.textContent).toContain("Garage, behind the freezer");
    expect(node.previousElementSibling?.classList.contains("device-config")).toBe(true);
    // The line is ellipsis-truncated; the native tooltip carries the full text.
    expect(node.getAttribute("title")).toBe("Garage, behind the freezer");
  });

  it("renders no comment node when the device has none", async () => {
    const el = await mount({});
    expect(el.shadowRoot!.querySelector(".device-comment")).toBeNull();
  });
});
