/**
 * @vitest-environment happy-dom
 *
 * Pins that the component editor's section-unmount announcement
 * survives detachment: disconnectedCallback runs after the node left
 * the tree, so the dispatch must ride the mount-time parent or the
 * page's listener never learns the section is gone (#1483).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import "../../_mock-webawesome.js";

import { ESPHomeDeviceSectionConfig } from "../../../src/components/device/device-section-config.js";

describe("section-unmount announcement", () => {
  it("rides the mount-time parent past detachment", async () => {
    const c = new ESPHomeDeviceSectionConfig();
    const outer = document.createElement("div");
    const shadow = outer.attachShadow({ mode: "open" });
    document.body.appendChild(outer);
    const unmounts: unknown[] = [];
    outer.addEventListener("section-unmount", (e) =>
      unmounts.push((e as CustomEvent<{ node: unknown }>).detail.node)
    );

    try {
      shadow.appendChild(c);
      // Lit removes the node first, then runs disconnectedCallback —
      // the dispatch below happens from a detached element.
      c.remove();
      expect(unmounts).toEqual([c]);
    } finally {
      outer.remove();
    }
  });
});
