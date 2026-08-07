/**
 * @vitest-environment happy-dom
 *
 * Pins that a discovered host's pair-dialog prefill seeds the receiver label
 * as the discovery row displays it (``remoteBuildPeerName``), so the field
 * matches what the pairings list will later show.
 */
import { describe, expect, it, vi } from "vitest";
import type { RemoteBuildPeer } from "../../../src/api/types/remote-build.js";
import { ESPHomeSettingsBuildOffload } from "../../../src/components/settings-dialog/build-offload-section.js";

function peer(overrides: Partial<RemoteBuildPeer> = {}): RemoteBuildPeer {
  return {
    name: "esphome-builder-xnnspgdv",
    hostname: "buildbox.local",
    port: 6052,
    source: "mdns",
    addresses: ["192.168.1.10"],
    server_version: "0.1.0",
    esphome_version: "2026.5.0",
    friendly_name: "",
    pin_sha256: "abc",
    remote_build_port: 6055,
    ...overrides,
  };
}

function openArgsFor(p: RemoteBuildPeer) {
  const section = new ESPHomeSettingsBuildOffload();
  const open = vi.fn();
  // _pairDialog is a @query getter; shadow it on the instance.
  Object.defineProperty(section, "_pairDialog", { value: { open } });
  (
    section as unknown as { _onPairDiscovered: (p: RemoteBuildPeer) => void }
  )._onPairDiscovered(p);
  expect(open).toHaveBeenCalledOnce();
  return open.mock.calls[0][0] as { receiverLabel?: string };
}

describe("discovered-host pair prefill", () => {
  it("seeds the receiver label from the friendly name", () => {
    expect(openArgsFor(peer({ friendly_name: "nas" })).receiverLabel).toBe("nas");
  });

  it("falls back to the instance name when no friendly name broadcast", () => {
    expect(openArgsFor(peer()).receiverLabel).toBe("esphome-builder-xnnspgdv");
  });

  it("maps an HA add-on receiver like the discovery row does", () => {
    expect(openArgsFor(peer({ friendly_name: "a1b2c3d4-esphome" })).receiverLabel).toBe(
      "Home Assistant App"
    );
  });
});
