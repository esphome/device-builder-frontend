/**
 * @vitest-environment happy-dom
 *
 * The drawer's migration badge reads the raw migration_available flag,
 * agreeing with the dashboard dot.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("../../../src/components/labels/device-labels-editor.js", () => ({}));

import { flush, identityLocalize } from "../../_dom.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";
import type { ESPHomeAPI } from "../../../src/api/esphome-api.js";
import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import { ESPHomeDeviceDrawerContent } from "../../../src/components/dashboard/device-drawer-content.js";

async function mountContent(
  device: ConfiguredDevice
): Promise<ESPHomeDeviceDrawerContent> {
  const api = {
    connectionGeneration: 1,
    subscribeDeviceReachability: vi.fn().mockResolvedValue({ unsubscribe: vi.fn() }),
  };
  const el = new ESPHomeDeviceDrawerContent();
  el.device = device;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._api = api as unknown as ESPHomeAPI;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._localize = identityLocalize;
  document.body.appendChild(el);
  await el.updateComplete;
  await flush();
  return el;
}

describe("drawer migration badge", () => {
  it("renders with its label when migration_available is set", async () => {
    const el = await mountContent(makeConfiguredDevice({ migration_available: true }));
    const badge = el.shadowRoot!.querySelector(".status-badge--migration");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain("dashboard.status_migration_available");
  });

  it("stays absent by default", async () => {
    const el = await mountContent(makeConfiguredDevice());
    expect(el.shadowRoot!.querySelector(".status-badge--migration")).toBeNull();
  });
});
