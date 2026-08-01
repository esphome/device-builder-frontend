/**
 * @vitest-environment happy-dom
 *
 * The picker element on its own: prefill URLs for both targets, the
 * popup-safe ready state, capture failure/abandonment, and the filter.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import toast from "sonner-js";
import { flushMicrotasks, mount } from "../_dom.js";
import { APIError } from "../../src/api/api-error.js";
import { ESPHomeFeedbackDevicePicker } from "../../src/components/feedback-device-picker.js";

describe("feedback-device-picker", () => {
  interface Deferred {
    resolve: (yaml: string) => void;
    reject: (err: unknown) => void;
  }

  const RAW_YAML = "esphome:\n  name: garage\nwifi:\n  password: hunter2";

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
  };

  let el: ESPHomeFeedbackDevicePicker;
  let reads: Deferred[];
  let openedUrls: string[];

  beforeEach(async () => {
    reads = [];
    openedUrls = [];
    vi.stubGlobal(
      "open",
      vi.fn((url: string) => {
        openedUrls.push(url);
        return null;
      })
    );
    el = await mount(new ESPHomeFeedbackDevicePicker());
    Object.assign(el as unknown as Record<string, unknown>, {
      _serverVersion: "1.8.0",
      _esphomeVersion: "2026.7.2",
      _devices: [DEVICE],
      _api: {
        serverInfo: { in_docker: true },
        getConfig: vi.fn(
          () =>
            new Promise<string>((resolve, reject) => {
              reads.push({ resolve, reject });
            })
        ),
        subscribeDeviceReachability: vi.fn((_name: string, cb: (s: unknown) => void) => {
          cb({
            active_source: "mdns",
            mdns_last_seen_seconds_ago: 300,
            mdns_ptr_ttl_seconds: 4500,
          });
          return Promise.resolve({ unsubscribe: () => Promise.resolve() });
        }),
      },
    });
    await el.updateComplete;
  });

  afterEach(() => {
    // The stubbed window.open must not leak into other files in this worker.
    vi.unstubAllGlobals();
  });

  const settle = async (predicate: () => boolean) => {
    for (let i = 0; i < 20 && !predicate(); i++) await flushMicrotasks(1);
  };

  const deviceRow = () =>
    [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>("button.link")].find((b) =>
      b.textContent!.includes("Garage Door")
    )!;

  const skipRow = () =>
    [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>("button.link")].find((b) =>
      b.textContent!.includes("feedback.device_skip")
    )!;

  const pick = async (yaml = RAW_YAML) => {
    deviceRow().click();
    await settle(() => reads.length > 0);
    reads[0].resolve(yaml);
    await settle(() => openedUrls.length > 0);
    await el.updateComplete;
  };

  it("prefills the builder form with masked config and facts", async () => {
    await pick();
    const url = new URL(openedUrls[0]);
    expect(url.origin + url.pathname).toBe(
      "https://github.com/esphome/device-builder/issues/new"
    );
    expect(url.searchParams.get("version")).toBe("1.8.0");
    const config = url.searchParams.get("config")!;
    expect(config).not.toContain("hunter2");
    expect(config).toContain("password: \u2022");
    const facts = url.searchParams.get("extra")!;
    expect(facts).toContain("Garage Door (garage.yaml)");
    expect(facts).toContain("Board: esp32dev");
    expect(facts).toContain("Platform: ESP32");
    expect(facts).toContain("ESPHome running: 2026.7.0");
    expect(facts).toContain("ESPHome: 2026.7.2");
    expect(facts).toContain("Installation: Docker");
  });

  it("stays up with the guaranteed link after the auto-open", async () => {
    // The capture outlives the click's transient activation, so the
    // auto-open can be popup-blocked; the anchor is the fallback.
    await pick();
    const anchor = el.shadowRoot!.querySelector<HTMLAnchorElement>("a.link");
    expect(anchor!.href).toBe(openedUrls[0]);
  });

  it("prefills the esphome form with the device's compiled version", async () => {
    el.target = "esphome";
    await el.updateComplete;
    await pick();
    const url = new URL(openedUrls[0]);
    expect(url.origin + url.pathname).toBe(
      "https://github.com/esphome/esphome/issues/new"
    );
    expect(url.searchParams.get("version")).toBe("2026.7.1");
    expect(url.searchParams.get("additional")).toContain("Garage Door (garage.yaml)");
    expect(url.searchParams.get("config")).toContain("password: \u2022");
  });

  it("skip keeps today's URL plus the builder's required config sentinel", async () => {
    const closed = vi.fn();
    el.addEventListener("picker-close", closed);
    skipRow().click();
    const builder = new URL(openedUrls[0]);
    expect(builder.searchParams.get("config")).toBe("not device specific");
    expect(builder.searchParams.get("version")).toBe("1.8.0");
    expect(builder.searchParams.get("extra")).toBeNull();
    expect(closed).toHaveBeenCalledTimes(1);

    el.target = "esphome";
    await el.updateComplete;
    skipRow().click();
    const esphome = new URL(openedUrls[1]);
    expect(esphome.searchParams.get("config")).toBeNull();
    expect(esphome.searchParams.get("version")).toBe("2026.7.2");
  });

  it("opens the form without config when the capture fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    deviceRow().click();
    await settle(() => reads.length > 0);
    reads[0].reject(new APIError("internal_error", "boom"));
    await settle(() => openedUrls.length > 0);
    const url = new URL(openedUrls[0]);
    expect(url.searchParams.get("config")).toBeNull();
    expect(url.searchParams.get("extra")).toContain("Garage Door (garage.yaml)");
    // The toast is the only signal the config is missing from the form.
    expect(toast.error).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("keeps the whole URL under the budget for a huge config", async () => {
    const huge = Array.from(
      { length: 800 },
      (_, i) => `  line_${i}: value-${i}-abcdefghijklmnop`
    ).join("\n");
    await pick(`esphome:\n${huge}`);
    const url = openedUrls[0];
    expect(url.length).toBeLessThanOrEqual(8000);
    expect(new URL(url).searchParams.get("config")).toContain(
      "[config truncated to fit the pre-filled URL]"
    );
    // The ready copy says the config was trimmed instead of staying silent.
    expect(el.shadowRoot!.textContent).toContain("feedback.device_ready_truncated");
  });

  it("announces an empty fleet", async () => {
    Object.assign(el as unknown as Record<string, unknown>, { _devices: [] });
    await el.updateComplete;
    const status = el.shadowRoot!.querySelector('[role="status"]');
    expect(status!.textContent).toContain("feedback.device_none");
  });

  it("prefills the status form with the drawer's mDNS answer", async () => {
    el.target = "status";
    await el.updateComplete;
    await pick();
    const url = new URL(openedUrls[0]);
    expect(url.searchParams.get("template")).toBe("device_status.yml");
    expect(url.searchParams.get("mdns-expiry")).toBe("Expires in 1h 10m");
    expect(url.searchParams.get("observed")).toContain("State:");
    expect(url.searchParams.get("config")).toContain("password: \u2022");
  });

  it("opens the status form with an mDNS fallback when reachability stalls", async () => {
    (
      el as unknown as {
        _api: { subscribeDeviceReachability: unknown };
      }
    )._api.subscribeDeviceReachability = vi.fn(() => new Promise(() => undefined));
    el.target = "status";
    await el.updateComplete;
    vi.useFakeTimers();
    try {
      deviceRow().click();
      await vi.advanceTimersByTimeAsync(0);
      reads[0].resolve(RAW_YAML);
      // The 3s snapshot timeout elapses; the form must still open.
      await vi.advanceTimersByTimeAsync(3000);
    } finally {
      vi.useRealTimers();
    }
    await settle(() => openedUrls.length > 0);
    const url = new URL(openedUrls[0]);
    expect(url.searchParams.get("mdns-expiry")).toBe("reachability read failed");
  });

  it("drops a capture that resolves after the picker unmounted", async () => {
    deviceRow().click();
    await settle(() => reads.length > 0);
    el.remove();
    reads[0].resolve(RAW_YAML);
    await flushMicrotasks(10);
    expect(openedUrls).toHaveLength(0);
  });

  it("drops a capture that resolves while the dialog is hiding", async () => {
    // Between close() and after-hide the element stays connected; the
    // active flag is what abandons the capture in that window.
    deviceRow().click();
    await settle(() => reads.length > 0);
    el.active = false;
    reads[0].resolve(RAW_YAML);
    await flushMicrotasks(10);
    expect(openedUrls).toHaveLength(0);
  });

  it("filters devices above the threshold", async () => {
    const fleet = Array.from({ length: 10 }, (_, i) => ({
      ...DEVICE,
      configuration: `dev-${i}.yaml`,
      name: `dev-${i}`,
      friendly_name: i === 3 ? "Kitchen Lamp" : `Device ${i}`,
    }));
    Object.assign(el as unknown as Record<string, unknown>, { _devices: fleet });
    await el.updateComplete;
    const input = el.shadowRoot!.querySelector<HTMLInputElement>(".device-filter")!;
    expect(input).not.toBeNull();

    input.value = "kitchen";
    input.dispatchEvent(new Event("input"));
    await el.updateComplete;
    const rows = [
      ...el.shadowRoot!.querySelectorAll<HTMLButtonElement>("button.link"),
    ].filter((b) => !b.textContent!.includes("feedback.device_skip"));
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Kitchen Lamp");

    // A needle matching nothing shows the announced empty state.
    input.value = "zzz";
    input.dispatchEvent(new Event("input"));
    await el.updateComplete;
    const status = el.shadowRoot!.querySelector('[role="status"]');
    expect(status!.textContent).toContain("feedback.device_no_matches");
  });
});
