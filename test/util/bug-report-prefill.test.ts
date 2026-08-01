import { describe, expect, it } from "vitest";
import type { ConfiguredDevice } from "../../src/api/types/devices.js";
import type { ReachabilityStateEvent } from "../../src/api/types/reachability.js";
import {
  buildDeviceIssueUrl,
  deviceFacts,
  skipDeviceUrl,
} from "../../src/util/bug-report-prefill.js";

const CTX = {
  serverVersion: "1.8.0",
  esphomeVersion: "2026.7.2",
  installation: "Docker",
};

const DEVICE = {
  configuration: "garage.yaml",
  name: "garage",
  friendly_name: "Garage Door",
  current_version: "2026.7.1",
  target_platform: "ESP32S3",
  board_id: "esp32dev",
  loaded_integrations: ["esp32", "wifi"],
  runtime_state: {
    deployed_version: "2026.7.0",
    state: "online",
    active_source: "mdns",
    ip_addresses: ["192.168.1.5"],
  },
} as unknown as ConfiguredDevice;

describe("deviceFacts", () => {
  it("lists every known fact for the builder path", () => {
    expect(deviceFacts(DEVICE, "builder", CTX)).toBe(
      [
        "- Device: Garage Door (garage.yaml)",
        "- Board: esp32dev",
        "- Platform: ESP32",
        "- ESPHome running: 2026.7.0",
        "- ESPHome: 2026.7.2",
        "- Installation: Docker",
      ].join("\n")
    );
  });

  it("omits the ESPHome line on the esphome path and empty facts", () => {
    const sparse = {
      ...DEVICE,
      board_id: "",
      target_platform: "",
      loaded_integrations: [],
      runtime_state: { deployed_version: "" },
    } as unknown as ConfiguredDevice;
    expect(deviceFacts(sparse, "esphome", { ...CTX, installation: "" })).toBe(
      "- Device: Garage Door (garage.yaml)"
    );
  });
});

describe("skipDeviceUrl", () => {
  it("satisfies the builder form's required config field", () => {
    const url = skipDeviceUrl("builder", CTX);
    expect(url.searchParams.get("config")).toBe("not device specific");
    expect(url.searchParams.get("version")).toBe("1.8.0");
  });

  it("keeps the esphome form untouched beyond the version", () => {
    const url = skipDeviceUrl("esphome", CTX);
    expect(url.searchParams.get("config")).toBeNull();
    expect(url.searchParams.get("version")).toBe("2026.7.2");
  });
});

describe("buildDeviceIssueUrl", () => {
  it("targets each repo's field ids and prefers the compiled version", () => {
    const builder = buildDeviceIssueUrl("builder", DEVICE, "wifi:\n  ssid: x", CTX);
    expect(builder.url.searchParams.get("extra")).toContain("Garage Door");
    expect(builder.url.searchParams.get("config")).toContain("ssid: x");
    expect(builder.url.searchParams.get("version")).toBe("1.8.0");
    expect(builder.truncated).toBe(false);

    const esphome = buildDeviceIssueUrl("esphome", DEVICE, "", CTX);
    expect(esphome.url.searchParams.get("additional")).toContain("Garage Door");
    expect(esphome.url.searchParams.get("config")).toBeNull();
    expect(esphome.url.searchParams.get("version")).toBe("2026.7.1");
  });

  it("prefills the status form with observed facts and the mDNS answer", () => {
    const built = buildDeviceIssueUrl("status", DEVICE, "wifi:\n  ssid: x", CTX, {
      active_source: "mdns",
      mdns_last_seen_seconds_ago: 300,
      mdns_ptr_ttl_seconds: 4500,
    } as ReachabilityStateEvent);
    expect(built.url.origin + built.url.pathname).toBe(
      "https://github.com/esphome/device-builder/issues/new"
    );
    expect(built.url.searchParams.get("template")).toBe("device_status.yml");
    expect(built.url.searchParams.get("version")).toBe("1.8.0");
    expect(built.url.searchParams.get("mdns-expiry")).toBe("Expires in 1h 10m");
    const observed = built.url.searchParams.get("observed")!;
    expect(observed).toContain("State: online");
    expect(observed).toContain("Reachability source: mdns");
    expect(observed).toContain("IP: 192.168.x.x");
    expect(observed).not.toContain("192.168.1.5");
    expect(observed).toContain("ESPHome: 2026.7.2");
  });

  it("names the reason when no mDNS countdown applies", () => {
    const expiry = (
      reachability: Partial<ReachabilityStateEvent> | null,
      device: ConfiguredDevice = DEVICE
    ) =>
      buildDeviceIssueUrl(
        "status",
        device,
        "",
        CTX,
        reachability as ReachabilityStateEvent | null
      ).url.searchParams.get("mdns-expiry");
    expect(expiry(null)).toBe("reachability read failed");
    expect(expiry({ active_source: "ping", mdns_last_seen_seconds_ago: null })).toBe(
      "no mDNS row"
    );
    expect(
      expiry({
        active_source: "mdns",
        mdns_last_seen_seconds_ago: 60,
        mdns_ptr_ttl_seconds: 4500,
      })
    ).toBe("no expiry countdown (heard recently)");
    expect(
      expiry({
        active_source: "ping",
        mdns_last_seen_seconds_ago: 300,
        mdns_ptr_ttl_seconds: 4500,
      })
    ).toBe("no expiry countdown (mDNS not the active source)");
    expect(
      expiry({
        active_source: "mdns",
        mdns_last_seen_seconds_ago: 300,
        mdns_ptr_ttl_seconds: null,
      })
    ).toBe("no expiry countdown (no PTR TTL)");
    const offline = {
      ...DEVICE,
      runtime_state: { ...DEVICE.runtime_state, state: "offline" },
    } as unknown as ConfiguredDevice;
    expect(
      expiry(
        {
          active_source: "mdns",
          mdns_last_seen_seconds_ago: 300,
          mdns_ptr_ttl_seconds: 4500,
        },
        offline
      )
    ).toBe("no expiry countdown (device offline)");
    expect(
      expiry({
        active_source: "mdns",
        mdns_last_seen_seconds_ago: 4500,
        mdns_ptr_ttl_seconds: 4500,
      })
    ).toBe("Expires soon");
  });

  it("takes the source from the snapshot but keeps the state live", () => {
    const offlineDevice = {
      ...DEVICE,
      runtime_state: { ...DEVICE.runtime_state, state: "offline" },
    } as unknown as ConfiguredDevice;
    const observed = buildDeviceIssueUrl("status", offlineDevice, "", CTX, {
      active_source: "ping",
      state: "online",
      mdns_last_seen_seconds_ago: 300,
      mdns_ptr_ttl_seconds: 4500,
    } as ReachabilityStateEvent).url.searchParams.get("observed")!;
    expect(observed).toContain("Reachability source: ping");
    expect(observed).toContain("State: offline");
  });

  it("blunts every address family in the observed IP line", () => {
    const facts = (runtime: object) =>
      deviceFacts(
        {
          ...DEVICE,
          runtime_state: { ...DEVICE.runtime_state, ...runtime },
        } as unknown as ConfiguredDevice,
        "status",
        CTX
      );
    expect(facts({ ip_addresses: ["10.0.42.7", "fe80::abcd:12ff:fe34:5678"] })).toContain(
      "IP: 10.0.x.x, fe80::x"
    );
    const unrecognised = {
      ...DEVICE,
      ip: "garage.local",
      runtime_state: { ...DEVICE.runtime_state, ip_addresses: [] },
    } as unknown as ConfiguredDevice;
    expect(deviceFacts(unrecognised, "status", CTX)).toContain("IP: x");
    const ported = {
      ...DEVICE,
      runtime_state: { ...DEVICE.runtime_state, ip_addresses: ["192.168.1.5:6053"] },
    } as unknown as ConfiguredDevice;
    expect(deviceFacts(ported, "status", CTX)).toContain("IP: x");
    const addressless = {
      ...DEVICE,
      ip: "",
      runtime_state: { ...DEVICE.runtime_state, ip_addresses: [] },
    } as unknown as ConfiguredDevice;
    expect(deviceFacts(addressless, "status", CTX)).toContain("IP: none resolved");
  });

  it("status skip satisfies both required fields", () => {
    const url = skipDeviceUrl("status", CTX);
    expect(url.searchParams.get("config")).toBe("not device specific");
    expect(url.searchParams.get("mdns-expiry")).toBe("not device specific");
    expect(url.searchParams.get("version")).toBe("1.8.0");
  });

  it("reports truncation for a config past the budget", () => {
    const huge = Array.from({ length: 800 }, (_, i) => `line_${i}: v${i}`).join("\n");
    expect(buildDeviceIssueUrl("builder", DEVICE, huge, CTX).truncated).toBe(true);
  });
});
