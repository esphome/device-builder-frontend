import type { ESPHomeDeviceNavigator } from "../../../src/components/device/device-navigator.js";

/** The Components subgroup header titled ``title``. */
export function subgroupHeader(nav: ESPHomeDeviceNavigator, title: string): HTMLElement {
  const header = [
    ...nav.shadowRoot!.querySelectorAll<HTMLElement>(".nav-subgroup-header"),
  ].find((h) => h.querySelector(".nav-subgroup-title")?.textContent?.includes(title));
  if (!header) throw new Error(`fixture: subgroup ${title} not found`);
  return header;
}

/** Click a subgroup header and settle the render. */
export async function clickSubgroup(
  nav: ESPHomeDeviceNavigator,
  title: string
): Promise<void> {
  subgroupHeader(nav, title).click();
  await nav.updateComplete;
}
