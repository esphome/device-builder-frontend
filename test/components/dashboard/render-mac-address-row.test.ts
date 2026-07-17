/**
 * Empty-state behaviour of the drawer's mDNS-derived rows.
 *
 * MAC address and deployed config hash show "Waiting for mDNS discovery" while a
 * native-API device hasn't announced (#1453), but "This device does not have
 * Native API" for a no-api device, whose MAC / config hash arrive only on
 * ESPHome 2026.7.0+ (_http._tcp identity TXT) and never on older firmware; the
 * ethernet / bluetooth waiting rows hide entirely for such devices. The deployed
 * version row is exempt: it can arrive over the _http._tcp fallback on any firmware.
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
      _device({ current_version: "2026.5.2", runtime_state: { deployed_version: "" } }),
      _localize
    );
    const texts = valueTexts(result);
    expect(texts).toContain("2026.5.2");
    expect(texts).toContain("dashboard.drawer_waiting_for_mdns");
  });

  it("shows the deployed version for a no-api device reachable over MQTT", () => {
    // Delivered via the _http._tcp identity TXT; a no-api mdns claim is a
    // bare A-record resolve, so the gate is deployed_identity_live instead.
    const result = renderVersionSection(
      _device({
        current_version: "2026.7.1",
        api_enabled: false,
        runtime_state: {
          active_source: "mqtt",
          deployed_version: "2026.7.0",
          deployed_identity_live: true,
        },
      }),
      _localize
    );
    const texts = valueTexts(result);
    expect(texts).toContain("2026.7.1");
    expect(texts).toContain("2026.7.0");
  });

  it("blanks a no-api device's deployed version when the identity TXT went dark", () => {
    const result = renderVersionSection(
      _device({
        current_version: "2026.7.1",
        api_enabled: false,
        runtime_state: {
          active_source: "mqtt",
          deployed_version: "2026.7.0",
          deployed_identity_live: false,
        },
      }),
      _localize
    );
    const texts = valueTexts(result);
    expect(texts).not.toContain("2026.7.0");
    expect(texts).toContain("dashboard.drawer_waiting_for_mdns");
  });

  it("blanks an api device's deployed version while mDNS is dark", () => {
    const result = renderVersionSection(
      _device({
        current_version: "2026.7.1",
        api_enabled: true,
        runtime_state: {
          active_source: "ping",
          deployed_version: "2026.7.0",
          deployed_identity_live: false,
        },
      }),
      _localize
    );
    const texts = valueTexts(result);
    expect(texts).not.toContain("2026.7.0");
    expect(texts).toContain("dashboard.drawer_waiting_for_mdns");
  });

  it("shows an api device's deployed version off Native-API evidence while mDNS is dark", () => {
    // The backend read the version over a direct device_info connection
    // (Docker-bridge mDNS-dark) and vouches with deployed_identity_live.
    const result = renderVersionSection(
      _device({
        current_version: "2026.7.1",
        api_enabled: true,
        runtime_state: {
          active_source: "ping",
          deployed_version: "2026.7.0",
          deployed_identity_live: true,
        },
      }),
      _localize
    );
    const texts = valueTexts(result);
    expect(texts).toContain("2026.7.0");
  });
});

describe("renderConfigHashSection deployed row", () => {
  it("shows waiting-for-mDNS on the deployed hash for a native-API device", () => {
    const result = renderConfigHashSection(
      _device({
        expected_config_hash: "abc123",
        runtime_state: { deployed_config_hash: "" },
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
        runtime_state: { deployed_config_hash: "" },
        api_enabled: false,
      }),
      _localize
    );
    const texts = valueTexts(result);
    expect(texts).toContain("abc123");
    expect(texts).toContain("dashboard.drawer_no_native_api");
  });

  it("shows the deployed hash for a no-api device reachable over MQTT", () => {
    const result = renderConfigHashSection(
      _device({
        expected_config_hash: "abc123",
        api_enabled: false,
        runtime_state: {
          active_source: "mqtt",
          deployed_config_hash: "22e8e223",
          deployed_identity_live: true,
        },
      }),
      _localize
    );
    const texts = valueTexts(result);
    expect(texts).toContain("abc123");
    expect(texts).toContain("22e8e223");
  });

  it("blanks a no-api device's deployed hash when the identity TXT went dark", () => {
    const result = renderConfigHashSection(
      _device({
        expected_config_hash: "abc123",
        api_enabled: false,
        runtime_state: {
          active_source: "mqtt",
          deployed_config_hash: "22e8e223",
          deployed_identity_live: false,
        },
      }),
      _localize
    );
    const texts = valueTexts(result);
    expect(texts).not.toContain("22e8e223");
    expect(texts).toContain("dashboard.drawer_no_native_api");
  });

  it("blanks an api device's deployed hash while mDNS is dark", () => {
    const result = renderConfigHashSection(
      _device({
        expected_config_hash: "abc123",
        api_enabled: true,
        runtime_state: {
          active_source: "ping",
          deployed_config_hash: "22e8e223",
          deployed_identity_live: false,
        },
      }),
      _localize
    );
    const texts = valueTexts(result);
    expect(texts).not.toContain("22e8e223");
    expect(texts).toContain("dashboard.drawer_waiting_for_mdns");
  });

  it("shows an api device's deployed hash under identity evidence while mDNS is dark", () => {
    const result = renderConfigHashSection(
      _device({
        expected_config_hash: "abc123",
        api_enabled: true,
        runtime_state: {
          active_source: "ping",
          deployed_config_hash: "22e8e223",
          deployed_identity_live: true,
        },
      }),
      _localize
    );
    const texts = valueTexts(result);
    expect(texts).toContain("22e8e223");
  });
});
