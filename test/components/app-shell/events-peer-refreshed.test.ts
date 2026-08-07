import { describe, expect, it } from "vitest";
import { DeviceEventType } from "../../../src/api/types/event-subscription.js";
import type { RemoteBuildPeerRefreshedEventData } from "../../../src/api/types/remote-build-events.js";
import type { PeerSummary } from "../../../src/api/types/remote-build.js";
import type { ESPHomeApp } from "../../../src/components/app-shell.js";
import { handleEvent } from "../../../src/components/app-shell/events.js";

function makePeer(dashboard_id: string): PeerSummary {
  return {
    dashboard_id,
    // Distinct per row so a widened match predicate can't hide.
    pin_sha256: dashboard_id[0].repeat(64),
    label: "old-label",
    paired_at: 1,
    status: "approved",
    peer_ip: "10.0.0.1",
    connected: true,
    friendly_name: "Old-PC",
    ha_addon: false,
    label_auto: false,
  };
}

function refreshed(dashboard_id: string): RemoteBuildPeerRefreshedEventData {
  return {
    dashboard_id,
    pin_sha256: dashboard_id[0].repeat(64),
    label: "renamed",
    peer_ip: "10.0.0.9",
    paired_at: 2,
    friendly_name: "Office-PC",
    ha_addon: true,
    label_auto: true,
  };
}

type Host = Pick<ESPHomeApp, "_buildServerPeers">;

function dispatch(host: Host, evt: RemoteBuildPeerRefreshedEventData): void {
  handleEvent(host as ESPHomeApp, DeviceEventType.REMOTE_BUILD_PEER_REFRESHED, evt);
}

describe("handleEvent REMOTE_BUILD_PEER_REFRESHED", () => {
  it("patches the introduction fields, leaving status and connected alone", () => {
    const host: Host = { _buildServerPeers: [makePeer("alpha")] };

    dispatch(host, refreshed("alpha"));

    const [row] = host._buildServerPeers ?? [];
    expect(row.label).toBe("renamed");
    expect(row.label_auto).toBe(true);
    expect(row.friendly_name).toBe("Office-PC");
    expect(row.ha_addon).toBe(true);
    expect(row.peer_ip).toBe("10.0.0.9");
    expect(row.paired_at).toBe(2);
    expect(row.status).toBe("approved");
    expect(row.connected).toBe(true);
  });

  it("leaves other rows untouched while patching the match", () => {
    const alpha = makePeer("alpha");
    const beta = makePeer("beta");
    const host: Host = { _buildServerPeers: [alpha, beta] };

    dispatch(host, refreshed("alpha"));

    const [patched, untouched] = host._buildServerPeers ?? [];
    expect(patched.label).toBe("renamed");
    expect(untouched).toEqual(beta);
  });

  it("no-ops on an unknown dashboard_id", () => {
    const other = makePeer("beta");
    const host: Host = { _buildServerPeers: [other] };

    dispatch(host, refreshed("alpha"));

    expect(host._buildServerPeers).toEqual([other]);
  });

  it("no-ops before the initial snapshot seeded the list", () => {
    const host: Host = { _buildServerPeers: null };

    dispatch(host, refreshed("alpha"));

    expect(host._buildServerPeers).toBeNull();
  });
});
