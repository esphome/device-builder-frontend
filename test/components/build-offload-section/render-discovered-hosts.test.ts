/**
 * @vitest-environment happy-dom
 *
 * Pins that ``_renderDiscoveredHosts`` hides un-buildable dashboards
 * (``remote_build_port === 0``) and keeps real build servers. ``happy-dom`` is
 * needed both for the component import (WebAwesome touches ``CSSStyleSheet`` at
 * load) and to render the empty/loading status-row template back to its key.
 */
import { type TemplateResult } from "lit";
import { describe, expect, it } from "vitest";
import type { RemoteBuildPeer } from "../../../src/api/types/remote-build.js";
import { ESPHomeSettingsBuildOffload } from "../../../src/components/settings-dialog/build-offload-section.js";
import { identityLocalize, renderInto } from "../../_dom.js";

function peer(
  name: string,
  remote_build_port: number,
  friendly_name = ""
): RemoteBuildPeer {
  return {
    name,
    hostname: `${name}.local`,
    port: 6052,
    source: "mdns",
    addresses: ["192.168.1.10"],
    server_version: "0.1.0",
    esphome_version: "2026.5.0",
    friendly_name,
    pin_sha256: remote_build_port > 0 ? "abc" : "",
    remote_build_port,
  };
}

type Row = { row: string };

function makeHost(peers: RemoteBuildPeer[]) {
  return {
    _localize: identityLocalize,
    _discoveredHosts: new Map(peers.map((p) => [p.name, p])),
    _hasPairingFor: () => false,
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

// The empty / loading branch returns a single status-row TemplateResult; render
// it and read back the localize key the row shows.
function statusRowKey(result: unknown): string | null {
  if (Array.isArray(result)) return null;
  const el = renderInto(result as TemplateResult);
  return el.querySelector(".row-desc")?.textContent?.trim() ?? null;
}

describe("_renderDiscoveredHosts", () => {
  it("hides dashboards with no peer-link receiver (remote_build_port === 0)", () => {
    const host = makeHost([peer("addon", 0)]);
    // Every discovered host filtered out → the empty status row, not rows.
    expect(statusRowKey(renderDiscoveredHosts(host))).toBe(
      "settings.remote_build_peers_empty"
    );
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

function rowTitle(peerInfo: RemoteBuildPeer): string | null {
  const fn = (
    ESPHomeSettingsBuildOffload.prototype as unknown as Record<
      string,
      (p: RemoteBuildPeer) => TemplateResult
    >
  )._renderDiscoveredRow;
  const result = fn.call({ _localize: identityLocalize }, peerInfo);
  const el = renderInto(result);
  return el.querySelector(".row-title")?.textContent?.trim() ?? null;
}

describe("_renderDiscoveredRow display name", () => {
  it("prefers the friendly_name label over the opaque instance name", () => {
    expect(rowTitle(peer("esphome-builder-jwywnve", 6055, "MacBook-Pro"))).toBe(
      "MacBook-Pro"
    );
  });

  it("falls back to the instance name when friendly_name is empty", () => {
    expect(rowTitle(peer("esphome-builder-jwywnve", 6055))).toBe(
      "esphome-builder-jwywnve"
    );
  });

  it("falls back to the instance name for a whitespace-only friendly_name", () => {
    expect(rowTitle(peer("esphome-builder-jwywnve", 6055, "   "))).toBe(
      "esphome-builder-jwywnve"
    );
  });
});
