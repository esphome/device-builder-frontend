/**
 * @vitest-environment happy-dom
 *
 * Pins the kebab's wa-tooltip anchoring: with the native title gone, a
 * typo'd or renamed anchor id would degrade to no tooltip silently.
 */
import { describe, expect, it } from "vitest";

import { renderOpenHeaderMenu } from "./_esphome-header-actions-helpers.js";

describe("header-actions kebab tooltip", () => {
  it("anchors the wa-tooltip to the kebab button id, title gone", async () => {
    const el = await renderOpenHeaderMenu();
    const tips = [...el.shadowRoot!.querySelectorAll("wa-tooltip[for]")];
    expect(tips.length).toBe(1);
    for (const tip of tips) {
      const id = tip.getAttribute("for")!;
      expect(el.shadowRoot!.getElementById(id), id).not.toBeNull();
    }
    const kebab = el.shadowRoot!.querySelector(".menu-kebab")!;
    expect(kebab.hasAttribute("title")).toBe(false);
  });
});
