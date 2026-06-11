/**
 * @vitest-environment happy-dom
 *
 * Pins that ``_renderDiscoveredHosts`` hides un-buildable dashboards
 * (``remote_build_port === 0``) and keeps real build servers. ``happy-dom`` is
 * only for the component import (WebAwesome touches ``CSSStyleSheet`` at load);
 * the render call uses stubbed sentinels, no DOM.
 */
import { describe, expect, it } from "vitest";
import type { RemoteBuildPeer } from "../../../src/api/types/remote-build.js";
import { ESPHomeSettingsBuildOffload } from "../../../src/components/settings-dialog/build-offload-section.js";

function peer(name: string, remote_build_port: number): RemoteBuildPeer {
  return {
    name,
    hostname: `${name}.local`,
    port: 6052,
    source: "mdns",
    addresses: ["192.168.1.10"],
    server_version: "0.1.0",
    esphome_version: "2026.5.0",
    pin_sha256: remote_build_port > 0 ? "abc" : "",
    remote_build_port,
  };
}

type Row = { row: string };

function makeHost(peers: RemoteBuildPeer[]) {
  return {
    _discoveredHosts: new Map(peers.map((p) => [p.name, p])),
    _hasPairingFor: () => false,
    _statusRow: (key: string) => ({ status: key }),
    _renderDiscoveredRow: (p: RemoteBuildPeer): Row => ({ row: p.name }),
  };
}

function renderDiscoveredHosts(host: ReturnType<typeof makeHost>): unknown {
  // Private method; call it against the faked host.
  const fn = (
    ESPHomeSettingsBuildOffload.prototype as unknown as Record<string, () => unknown>
  )._renderDiscoveredHosts;
  return fn.call(host);
}

describe("_renderDiscoveredHosts", () => {
  it("hides dashboards with no peer-link receiver (remote_build_port === 0)", () => {
    const host = makeHost([peer("addon", 0)]);
    // Every discovered host filtered out → the empty status row, not rows.
    expect(renderDiscoveredHosts(host)).toEqual({
      status: "settings.remote_build_peers_empty",
    });
  });

  it("keeps build servers that bound a peer-link receiver", () => {
    const host = makeHost([peer("buildbox", 6055)]);
    expect(renderDiscoveredHosts(host)).toEqual([{ row: "buildbox" }]);
  });

  it("renders only the buildable peers from a mixed set", () => {
    const host = makeHost([peer("addon", 0), peer("buildbox", 6055)]);
    expect(renderDiscoveredHosts(host)).toEqual([{ row: "buildbox" }]);
  });
});
