// @vitest-environment happy-dom
//
// Pins the pairing-address disclosure: hostname:port summary, IP:port
// lines behind the chevron, and the per-line copy button (which must
// not toggle the disclosure).

import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("../../../src/util/copy-to-clipboard.js", () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
}));
vi.mock("../../../src/util/notify.js", () => ({
  notify: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

import type { IdentityView } from "../../../src/api/types/remote-build.js";
import { renderPairingAddress } from "../../../src/components/shared/pairing-address.js";
import { copyToClipboard } from "../../../src/util/copy-to-clipboard.js";
import { notify } from "../../../src/util/notify.js";
import { identityLocalize, renderInto } from "../../_dom.js";

const IDENTITY: IdentityView = {
  dashboard_id: "dash-0",
  pin_sha256: "cd".repeat(32),
  server_version: "1.2.0",
  esphome_version: "2026.6.1",
  listener_bound: true,
  listener_host: "esphome-builder-abc.local",
  listener_addresses: ["192.168.1.5", "fd00::a1"],
  listener_port: 6055,
};

describe("renderPairingAddress", () => {
  it("renders the hostname summary with the IPs behind the chevron", () => {
    const el = renderInto(renderPairingAddress(identityLocalize, IDENTITY));
    expect(el.querySelector("details.pairing-address summary code")?.textContent).toBe(
      "esphome-builder-abc.local:6055"
    );
    const ips = [...el.querySelectorAll(".pairing-address-ip code")].map(
      (c) => c.textContent
    );
    expect(ips).toEqual(["192.168.1.5:6055", "[fd00::a1]:6055"]);
  });

  it("every line carries a copy button; copying doesn't toggle the disclosure", async () => {
    const el = renderInto(renderPairingAddress(identityLocalize, IDENTITY));
    const details = el.querySelector<HTMLDetailsElement>("details")!;
    const buttons = el.querySelectorAll<HTMLButtonElement>(".pairing-address-copy");
    expect(buttons.length).toBe(3);
    buttons[0].click();
    await Promise.resolve();
    expect(copyToClipboard).toHaveBeenCalledWith("esphome-builder-abc.local:6055");
    await Promise.resolve();
    expect(notify.success).toHaveBeenCalled();
    expect(details.open).toBe(false);
  });

  it("clicking the address text doesn't toggle the disclosure", () => {
    const el = renderInto(renderPairingAddress(identityLocalize, IDENTITY));
    const details = el.querySelector<HTMLDetailsElement>("details")!;
    el.querySelector<HTMLElement>("summary code")!.click();
    expect(details.open).toBe(false);
  });

  it("renders a plain line without IPs and nothing without a port", () => {
    const plain = renderInto(
      renderPairingAddress(identityLocalize, {
        ...IDENTITY,
        listener_host: null,
        listener_addresses: [],
      })
    );
    expect(plain.querySelector("details")).toBeNull();
    expect(plain.querySelector(".pairing-address-line code")?.textContent).toBe(
      `${window.location.hostname}:6055`
    );
    const down = renderInto(
      renderPairingAddress(identityLocalize, { ...IDENTITY, listener_port: null })
    );
    expect(down.querySelector(".pairing-address-line")).toBeNull();
  });
});
