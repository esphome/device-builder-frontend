/**
 * @vitest-environment happy-dom
 *
 * The plaintext lock is the only encryption state that deep-links to the api
 * section's Enable-encryption affordance; encrypted shows nothing and the
 * other attention states stay passive icons.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/tooltip/tooltip.js", () => ({}));

import { clickCollect } from "../_dom.js";
import { mountDeviceCard as mount } from "./_device-card.js";

describe("device-card encryption deep-link", () => {
  it("plaintext lock is a button that deep-links and does not open the drawer", async () => {
    const el = await mount({
      apiEnabled: true,
      apiEncrypted: false,
      apiEncryptionActive: null,
    });
    const btn = el.shadowRoot!.querySelector<HTMLButtonElement>("button.encryption-icon");
    expect(btn).not.toBeNull();
    // The accessible name carries the warning plus the action, not the
    // plain warning tooltip.
    expect(btn!.getAttribute("aria-label")).toBe(
      "dashboard.table_status_unencrypted_action_tooltip"
    );
    // stopPropagation keeps the card's own click (card-click → drawer) from firing.
    expect(clickCollect(el, btn!, ["open-encryption-settings", "card-click"])).toEqual([
      "open-encryption-settings",
    ]);
  });

  it("stays passive in select mode so the whole card remains one toggle target", async () => {
    const el = await mount({
      apiEnabled: true,
      apiEncrypted: false,
      apiEncryptionActive: null,
      selectMode: true,
    });
    expect(el.shadowRoot!.querySelector("button.encryption-icon")).toBeNull();
    expect(el.shadowRoot!.querySelector("wa-icon.encryption-icon")).not.toBeNull();
  });

  it("encrypted device shows no lock at all", async () => {
    const el = await mount({
      apiEnabled: true,
      apiEncrypted: true,
      apiEncryptionActive: "Noise_NNpsk0_25519_ChaChaPoly_SHA256",
    });
    expect(el.shadowRoot!.querySelector(".encryption-icon")).toBeNull();
  });

  it("mismatch stays a passive icon (encryption already configured)", async () => {
    const el = await mount({
      apiEnabled: true,
      apiEncrypted: true,
      apiEncryptionActive: "",
    });
    expect(el.shadowRoot!.querySelector("button.encryption-icon")).toBeNull();
    expect(el.shadowRoot!.querySelector("wa-icon.encryption-icon")).not.toBeNull();
  });
});
