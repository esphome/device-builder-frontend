/**
 * @vitest-environment happy-dom
 *
 * The kebab Search item is the visible affordance for the Cmd+K command
 * palette; clicking it must fire the window event the palette listens for and
 * close the menu.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { OPEN_COMMAND_PALETTE_EVENT } from "../../src/components/command-palette-actions.js";
import { ESPHomeHeaderActions } from "../../src/components/esphome-header-actions.js";

async function renderOpenMenu(): Promise<ESPHomeHeaderActions> {
  const el = new ESPHomeHeaderActions();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._open = true;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function searchItem(el: ESPHomeHeaderActions): HTMLElement {
  return el.shadowRoot!.querySelector('wa-icon[name="magnify"]')!
    .parentElement as HTMLElement;
}

describe("header-actions Search item", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the Search item with a shortcut hint", async () => {
    const el = await renderOpenMenu();
    expect(el.shadowRoot!.querySelector('wa-icon[name="magnify"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".menu-item-shortcut")).not.toBeNull();
  });

  it("fires the open-palette event and closes the menu on click", async () => {
    const el = await renderOpenMenu();
    const listener = vi.fn();
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, listener);

    searchItem(el).click();

    expect(listener).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._open).toBe(false);
    window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, listener);
  });
});
