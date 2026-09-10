import type { ESPHomeTableRowMenu } from "../../../src/components/dashboard/table-row-menu.js";

/** The rendered row-menu item whose label is the translation key. */
export function findMenuItem(el: ESPHomeTableRowMenu, key: string): Element | undefined {
  return [...el.shadowRoot!.querySelectorAll(".menu-item")].find((item) =>
    item.textContent!.includes(key)
  );
}
