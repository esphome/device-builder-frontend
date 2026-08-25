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
    // The icon is the cue that separates it from the filename line above.
    expect(node.querySelector("wa-icon")?.getAttribute("name")).toBe(
      "comment-text-outline"
    );
    // The icon is aria-hidden, so the paragraph names itself for AT; a bare
    // <p> would not expose an author label, hence role="note".
    expect(node.getAttribute("role")).toBe("note");
    // The helper's identity localizer drops params; swap one in that echoes
    // them so the comment is proven to reach the ICU key.
    (el as unknown as { _localize: unknown })._localize = (
      k: string,
      v?: Record<string, string | number>
    ) => `${k}|${v?.comment ?? ""}`;
    await el.updateComplete;
    expect(
      el.shadowRoot!.querySelector(".device-comment")!.getAttribute("aria-label")
    ).toBe("dashboard.device_comment|Garage, behind the freezer");
  });

  it("renders no comment node when the device has none", async () => {
    const el = await mount({});
    expect(el.shadowRoot!.querySelector(".device-comment")).toBeNull();
  });
});
