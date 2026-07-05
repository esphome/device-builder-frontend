/**
 * @vitest-environment happy-dom
 *
 * "Check for updates" only works under an ESPHome Desktop app (0.14.0+) that
 * exposes its update api, so the kebab entry must render only when the backend
 * reports desktop_update_capable and stay hidden otherwise.
 */
import { afterEach, describe, expect, it } from "vitest";

import { ESPHomeHeaderActions } from "../../src/components/esphome-header-actions.js";

async function renderOpenMenu(
  desktopUpdateCapable: boolean
): Promise<ESPHomeHeaderActions> {
  const el = new ESPHomeHeaderActions();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._desktopUpdateCapable = desktopUpdateCapable;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._open = true;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("header-actions Check for updates visibility", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the entry when the desktop app is update-capable", async () => {
    const el = await renderOpenMenu(true);
    expect(el.shadowRoot!.querySelector('wa-icon[name="update"]')).not.toBeNull();
  });

  it("hides the entry when not update-capable", async () => {
    const el = await renderOpenMenu(false);
    expect(el.shadowRoot!.querySelector('wa-icon[name="update"]')).toBeNull();
  });

  it("dispatches open-check-updates and closes the menu on click", async () => {
    const el = await renderOpenMenu(true);
    let fired = false;
    el.addEventListener("open-check-updates", () => {
      fired = true;
    });
    const item = el
      .shadowRoot!.querySelector('wa-icon[name="update"]')!
      .closest<HTMLElement>(".menu-item");
    item!.click();
    expect(fired).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._open).toBe(false);
  });
});
