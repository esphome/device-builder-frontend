/**
 * Empty-state behaviour of the drawer's mDNS-derived rows.
 *
 * MAC address and deployed config hash show "Waiting for mDNS discovery" while a
 * native-API device hasn't announced (#1453), but "This device does not have
 * Native API" for a no-api device whose MAC / config hash can never arrive; the
 * ethernet / bluetooth waiting rows hide entirely for such devices. The deployed
 * version row is exempt: it can still arrive over the _http._tcp fallback.
 */
import { nothing } from "lit";
import { describe, expect, it } from "vitest";
import {
  renderBluetoothMacRow,
  renderConfigHashSection,
  renderEthernetMacRow,
  renderMacAddressRow,
  renderVersionSection,
} from "../../../src/components/dashboard/device-drawer-content/render-sections.js";
import { identityLocalize } from "../../_dom.js";
import { findTemplatesByAnchor } from "../../_lit-template-walker.js";
import { makeConfiguredDevice as _device } from "../../_make-configured-device.js";

const _localize = identityLocalize;

// Text bound inside each row's `.value` div.
const valueTexts = (result: unknown): unknown[] =>
  findTemplatesByAnchor(result, 'class="value').flatMap((t) => t.values);

describe("renderMacAddressRow", () => {
  it("shows the waiting-for-mDNS message when a native-API device hasn't announced", () => {
    const result = renderMacAddressRow(
      _device({ mac_address: "", api_enabled: true }),
      _localize
    );
    expect(valueTexts(result)).toContain("dashboard.drawer_waiting_for_mdns");
  });

  it("says the device has no Native API when api is disabled", () => {
    const result = renderMacAddressRow(
      _device({ mac_address: "", api_enabled: false }),
      _localize
    );
    expect(valueTexts(result)).toContain("dashboard.drawer_no_native_api");
  });

  it("shows the MAC when present", () => {
    const result = renderMacAddressRow(
      _device({ mac_address: "AA:BB:CC:DD:EE:FF" }),
      _localize
    );
    expect(valueTexts(result)).toContain("AA:BB:CC:DD:EE:FF");
  });
});

describe("renderEthernetMacRow", () => {
  it("shows the distinct ethernet MAC when known", () => {
    const result = renderEthernetMacRow(
      _device({ mac_address: "AA:BB:CC:DD:EE:F1", ethernet_mac: "AA:BB:CC:DD:EE:F4" }),
      _localize
    );
    expect(valueTexts(result)).toContain("AA:BB:CC:DD:EE:F4");
  });

  it("shows waiting-for-mDNS while the primary MAC is pending and the YAML loads ethernet", () => {
    const result = renderEthernetMacRow(
      _device({
        mac_address: "",
        ethernet_mac: "",
        api_enabled: true,
        loaded_integrations: ["ethernet", "wifi"],
      }),
      _localize
    );
    expect(valueTexts(result)).toContain("dashboard.drawer_waiting_for_mdns");
  });

  it("hides the waiting hint when the device has no Native API", () => {
    const result = renderEthernetMacRow(
      _device({
        mac_address: "",
        ethernet_mac: "",
        api_enabled: false,
        loaded_integrations: ["ethernet", "wifi"],
      }),
      _localize
    );
    expect(result).toBe(nothing);
  });

  it("hides when the device has no ethernet integration", () => {
    const result = renderEthernetMacRow(
      _device({
        mac_address: "",
        ethernet_mac: "",
        api_enabled: true,
        loaded_integrations: ["wifi"],
      }),
      _localize
    );
    expect(result).toBe(nothing);
  });

  it("hides when the primary MAC is known but no distinct ethernet MAC was derived", () => {
    const result = renderEthernetMacRow(
      _device({
        mac_address: "AA:BB:CC:DD:EE:F1",
        ethernet_mac: "",
        loaded_integrations: ["ethernet"],
      }),
      _localize
    );
    expect(result).toBe(nothing);
  });
});

describe("renderBluetoothMacRow", () => {
  it("shows waiting-for-mDNS while pending when the YAML loads a BLE integration", () => {
    const result = renderBluetoothMacRow(
      _device({
        mac_address: "",
        bluetooth_mac: "",
        api_enabled: true,
        loaded_integrations: ["esp32_ble_tracker"],
      }),
      _localize
    );
    expect(valueTexts(result)).toContain("dashboard.drawer_waiting_for_mdns");
  });

  it("hides the waiting hint when the device has no Native API", () => {
    const result = renderBluetoothMacRow(
      _device({
        mac_address: "",
        bluetooth_mac: "",
        api_enabled: false,
        loaded_integrations: ["esp32_ble_tracker"],
      }),
      _localize
    );
    expect(result).toBe(nothing);
  });

  it("hides when the device loads no bluetooth integration", () => {
    const result = renderBluetoothMacRow(
      _device({
        mac_address: "",
        bluetooth_mac: "",
        api_enabled: true,
        loaded_integrations: ["wifi"],
      }),
      _localize
    );
    expect(result).toBe(nothing);
  });
});

describe("renderVersionSection deployed row", () => {
  it("shows waiting-for-mDNS on the deployed row when only the local version is known", () => {
    // Version is NOT gated on api_enabled: it can still arrive over the
    // _http._tcp mDNS fallback for MQTT-only devices.
    const result = renderVersionSection(
      _device({ current_version: "2026.5.2", deployed_version: "" }),
      _localize
    );
    const texts = valueTexts(result);
    expect(texts).toContain("2026.5.2");
    expect(texts).toContain("dashboard.drawer_waiting_for_mdns");
  });
});

describe("renderConfigHashSection deployed row", () => {
  it("shows waiting-for-mDNS on the deployed hash for a native-API device", () => {
    const result = renderConfigHashSection(
      _device({
        expected_config_hash: "abc123",
        deployed_config_hash: "",
        api_enabled: true,
      }),
      _localize
    );
    const texts = valueTexts(result);
    expect(texts).toContain("abc123");
    expect(texts).toContain("dashboard.drawer_waiting_for_mdns");
  });

  it("says the device has no Native API on the deployed hash when api is disabled", () => {
    const result = renderConfigHashSection(
      _device({
        expected_config_hash: "abc123",
        deployed_config_hash: "",
        api_enabled: false,
      }),
      _localize
    );
    const texts = valueTexts(result);
    expect(texts).toContain("abc123");
    expect(texts).toContain("dashboard.drawer_no_native_api");
  });
});
