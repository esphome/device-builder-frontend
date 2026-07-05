/**
 * Pins renderIpAddressRow's host fallback: ip_addresses isn't persisted
 * across restarts, so a cold-scanned device (empty list, populated d.ip)
 * must still render the IP row and its visit link from d.ip.
 */
import { describe, expect, it } from "vitest";
import type { ESPHomeDeviceDrawerContent } from "../../../src/components/dashboard/device-drawer-content.js";
import { renderIpAddressRow } from "../../../src/components/dashboard/device-drawer-content/render-sections.js";
import { identityLocalize } from "../../_dom.js";
import {
  extractAttributeBindings,
  findTemplatesByAnchor,
} from "../../_lit-template-walker.js";
import { makeConfiguredDevice as _device } from "../../_make-configured-device.js";

const _host = {
  _localize: identityLocalize,
  _ipExpanded: false,
} as unknown as ESPHomeDeviceDrawerContent;

const hrefs = (result: ReturnType<typeof renderIpAddressRow>) =>
  findTemplatesByAnchor(result, "<a").map((a) => extractAttributeBindings(a).href);

describe("renderIpAddressRow", () => {
  it("falls back to d.ip when ip_addresses is empty (cold scan)", () => {
    const result = renderIpAddressRow(
      _host,
      _device({ web_port: 80, ip: "10.0.0.5", ip_addresses: [] })
    );
    const valueText = findTemplatesByAnchor(result, "address-value-text");
    expect(valueText.flatMap((t) => t.values)).toContain("10.0.0.5");
    expect(hrefs(result)).toEqual(["http://10.0.0.5"]);
  });

  it("renders no link when both ip_addresses and d.ip are empty", () => {
    const result = renderIpAddressRow(
      _host,
      _device({ web_port: 80, ip: "", ip_addresses: [] })
    );
    expect(findTemplatesByAnchor(result, "<a")).toHaveLength(0);
  });

  it("shows waiting-for-first-signal when no IP is known", () => {
    const result = renderIpAddressRow(
      _host,
      _device({ web_port: 80, ip: "", ip_addresses: [] })
    );
    const texts = findTemplatesByAnchor(result, 'class="value').flatMap((t) => t.values);
    expect(texts).toContain("dashboard.drawer_waiting_for_signal");
  });

  it("links the resolved address to its own host", () => {
    const result = renderIpAddressRow(
      _host,
      _device({ web_port: 8080, ip: "10.0.0.5", ip_addresses: ["192.168.1.9"] })
    );
    expect(hrefs(result)).toEqual(["http://192.168.1.9:8080"]);
  });
});
