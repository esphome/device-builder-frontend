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
    const tip = el.shadowRoot!.querySelector("wa-tooltip[for]");
    expect(tip).not.toBeNull();
    const id = tip!.getAttribute("for")!;
    const kebab = el.shadowRoot!.getElementById(id);
    expect(kebab).not.toBeNull();
    expect(kebab!.classList.contains("menu-kebab")).toBe(true);
    expect(kebab!.hasAttribute("title")).toBe(false);
  });
});
