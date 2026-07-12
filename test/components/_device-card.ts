import { ESPHomeDeviceCard } from "../../src/components/device-card.js";

/**
 * Mount a device card with the shared kitchen fixture defaults.
 *
 * Callers still need their own `vi.mock` lines for the webawesome
 * icon/spinner modules — vi.mock is hoisted per test module.
 */
export async function mountDeviceCard(
  props: Partial<ESPHomeDeviceCard>
): Promise<ESPHomeDeviceCard> {
  const el = new ESPHomeDeviceCard();
  el.name = "kitchen";
  el.configuration = "kitchen.yaml";
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}
