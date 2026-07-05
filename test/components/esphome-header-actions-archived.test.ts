/**
 * @vitest-environment happy-dom
 *
 * Archived Devices is a dashboard concern; its dialog lives on the dashboard
 * page, so the kebab entry must only render on the dashboard route and stay
 * hidden in the editor where it would no-op (#1320).
 */
import { afterEach, describe, expect, it } from "vitest";

import { renderOpenHeaderMenu } from "./_esphome-header-actions-helpers.js";

describe("header-actions Archived Devices visibility", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the Archived Devices entry on the dashboard route", async () => {
    const el = await renderOpenHeaderMenu({ dashboardRoute: true });
    expect(
      el.shadowRoot!.querySelector('wa-icon[name="archive-outline"]')
    ).not.toBeNull();
  });

  it("hides the Archived Devices entry off the dashboard route", async () => {
    const el = await renderOpenHeaderMenu({ dashboardRoute: false });
    expect(el.shadowRoot!.querySelector('wa-icon[name="archive-outline"]')).toBeNull();
  });
});
