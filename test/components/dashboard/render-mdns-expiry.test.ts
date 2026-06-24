/**
 * Tests for the drawer's mDNS-expiry fold-down.
 *
 * Pins ``renderMdnsExpiry`` — the ``<details>`` the reachability
 * section mounts under the mDNS row showing "Expires in <countdown>"
 * (the device's record lifetime minus time since last heard) and
 * folding open to explain the passive-mDNS mechanism, naming the
 * device's actual record lifetime. The caller gates it on mDNS being
 * the active source; here we pin the null render and the localize
 * keys / args.
 */
import { nothing } from "lit";
import { describe, expect, it } from "vitest";
import { renderMdnsExpiry } from "../../../src/components/dashboard/device-drawer-render.js";
import { findTemplatesByAnchor, isTemplateResult } from "../../_lit-template-walker.js";

const _identityLocalize: (key: string) => string = (key) => key;

describe("renderMdnsExpiry", () => {
  it("renders a details fold-down when remaining + lifetime are present", () => {
    const result = renderMdnsExpiry(4321, 4500, _identityLocalize, "en");
    expect(isTemplateResult(result)).toBe(true);
    expect(findTemplatesByAnchor(result, "<details").length).toBe(1);
  });

  it("renders nothing when remaining is null (no PTR cached)", () => {
    expect(renderMdnsExpiry(null, 4500, _identityLocalize, "en")).toBe(nothing);
  });

  it("renders nothing when the lifetime is null (no PTR cached)", () => {
    expect(renderMdnsExpiry(4321, null, _identityLocalize, "en")).toBe(nothing);
  });

  it("says 'expires soon' instead of a stuck 0s once the countdown hits zero", () => {
    const keys: string[] = [];
    renderMdnsExpiry(
      0,
      4500,
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
      4321,
      4500,
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
      3600 + 14 * 60,
      4500,
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
