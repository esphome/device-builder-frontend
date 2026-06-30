/**
 * @vitest-environment happy-dom
 *
 * The card's encryption lock reads the RAW has_pending_changes, while the
 * modified dot reads the mDNS-gated showModified — so an mDNS-dark, hash-pending,
 * encrypted device shows the lock-clock and hides the dot, matching the drawer's
 * raw-flag badge instead of diverging (#1037).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));

import { ESPHomeDeviceCard } from "../../src/components/device-card.js";

async function mount(props: Partial<ESPHomeDeviceCard>): Promise<ESPHomeDeviceCard> {
  const el = new ESPHomeDeviceCard();
  el.name = "kitchen";
  el.configuration = "kitchen.yaml";
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("device-card encryption indicator uses the raw pending flag", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows encryption-pending but hides the modified dot when the gate is off", async () => {
    const el = await mount({
      hasPendingChanges: true, // raw: local edit not yet flashed
      showModified: false, // gated off: mDNS dark + hash-driven pending
      apiEnabled: true,
      apiEncrypted: true,
      apiEncryptionActive: null,
    });
    expect(el.shadowRoot!.querySelector(".encryption-icon.pending")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".indicator-dot--modified")).toBeNull();
  });
});
