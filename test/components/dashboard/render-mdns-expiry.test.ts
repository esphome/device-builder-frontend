/**
 * Tests for the drawer's mDNS-expiry fold-down.
 *
 * Pins ``renderMdnsExpiry`` — the ``<details>`` the reachability
 * section mounts under the mDNS row showing "Expires in <countdown>"
 * (the device's record lifetime minus time since last heard) and
 * folding open to explain the passive-mDNS mechanism, naming the
 * device's actual record lifetime. The phase classifier owns every
 * gate; here we pin the null render and the localize keys / args.
 */
import { nothing } from "lit";
import { describe, expect, it } from "vitest";
import { identityLocalize } from "../../_dom.js";
import { findTemplatesByAnchor, isTemplateResult } from "../../_lit-template-walker.js";
import { renderMdnsExpiry } from "../../../src/components/dashboard/device-drawer-render.js";
import type { MdnsExpiryPhase } from "../../../src/util/mdns-expiry.js";

const COUNTDOWN: MdnsExpiryPhase = { kind: "countdown", remaining: 4321, ttl: 4500 };

describe("renderMdnsExpiry", () => {
  it("renders a details fold-down for a countdown phase", () => {
    const result = renderMdnsExpiry(COUNTDOWN, identityLocalize, "en");
    expect(isTemplateResult(result)).toBe(true);
    expect(findTemplatesByAnchor(result, "<details").length).toBe(1);
  });

  it("renders nothing for every no-hint phase", () => {
    const phases: MdnsExpiryPhase[] = [
      { kind: "no-signal" },
      { kind: "offline" },
      { kind: "inactive-source" },
      { kind: "no-ttl" },
      { kind: "fresh" },
    ];
    for (const phase of phases) {
      expect(renderMdnsExpiry(phase, identityLocalize, "en")).toBe(nothing);
    }
  });

  it("says 'expires soon' instead of a stuck 0s at the eviction edge", () => {
    const keys: string[] = [];
    renderMdnsExpiry(
      { kind: "soon", ttl: 4500 },
      (key) => {
        keys.push(key);
        return key;
      },
      "en"
    );
    expect(keys).toContain("dashboard.drawer_mdns_expires_soon");
    expect(keys).not.toContain("dashboard.drawer_mdns_expires_in");
  });

  it("uses the summary and explainer localize keys", () => {
    const keys: string[] = [];
    renderMdnsExpiry(
      COUNTDOWN,
      (key) => {
        keys.push(key);
        return key;
      },
      "en"
    );
    expect(keys).toContain("dashboard.drawer_mdns_expires_in");
    expect(keys).toContain("dashboard.drawer_mdns_expires_explainer");
  });

  it("passes the countdown to the summary and the lifetime to the explainer", () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    renderMdnsExpiry(
      { kind: "countdown", remaining: 3600 + 14 * 60, ttl: 4500 },
      (key, args) => {
        calls.push([key, args]);
        return key;
      },
      "en"
    );
    const summary = calls.find(([key]) => key === "dashboard.drawer_mdns_expires_in");
    const explainer = calls.find(
      ([key]) => key === "dashboard.drawer_mdns_expires_explainer"
    );
    expect(summary?.[1]?.t).toBe("1h 14m");
    expect(explainer?.[1]?.lifetime).toBe("1h 15m");
  });
});
