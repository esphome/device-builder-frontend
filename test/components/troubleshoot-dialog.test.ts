/**
 * @vitest-environment happy-dom
 *
 * Pins the troubleshoot dialog: auto-check on open, Check again,
 * section rendering off the decision tree, the use_address save flow
 * with its snippet fallback, and subscription teardown on close.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));

import { baseDialogSettled, flush, mount } from "../_dom.js";
import { makeConfiguredDevice } from "../_make-configured-device.js";
import { makeReachabilityEvent } from "../_make-reachability-event.js";
import type { DeviceTroubleshootResult } from "../../src/api/types/troubleshoot.js";
import { ESPHomeTroubleshootDialog } from "../../src/components/troubleshoot-dialog.js";

const RESULT: DeviceTroubleshootResult = {
  configuration: "kitchen.yaml",
  address: "kitchen.local",
  icmp_available: true,
  zeroconf_running: true,
  dns_resolved: false,
  dns_addresses: [],
  dns_inconclusive: false,
  mdns_addresses: [],
  mdns_has_cached_trace: false,
  mdns_inconclusive: false,
  ping_attempted: true,
  ping_target: "10.0.0.42",
  ping_target_source: "persisted",
  ping_rtt_ms: null,
};

const WIFI_YAML = "wifi:\n  ssid: net\n";

interface ApiStub {
  troubleshootDevice: ReturnType<typeof vi.fn>;
  subscribeDeviceReachability: ReturnType<typeof vi.fn>;
  getConfig: ReturnType<typeof vi.fn>;
  updateConfig: ReturnType<typeof vi.fn>;
  serverInfo: { in_docker: boolean; ha_addon?: boolean } | null;
}

function makeApi(overrides: Partial<ApiStub> = {}): {
  api: ApiStub;
  unsubscribe: ReturnType<typeof vi.fn>;
} {
  const unsubscribe = vi.fn();
  const api: ApiStub = {
    troubleshootDevice: vi.fn().mockResolvedValue(RESULT),
    subscribeDeviceReachability: vi.fn().mockResolvedValue({ unsubscribe }),
    getConfig: vi.fn().mockResolvedValue(WIFI_YAML),
    updateConfig: vi.fn().mockResolvedValue(undefined),
    serverInfo: { in_docker: false },
    ...overrides,
  };
  return { api, unsubscribe };
}

async function openDialog(
  overrides: Partial<ApiStub> = {},
  device = makeConfiguredDevice({ ip: "10.0.0.42" })
) {
  const { api, unsubscribe } = makeApi(overrides);
  const el = new ESPHomeTroubleshootDialog();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._api = api;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._devices = [device];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._localize = (key: string) => key;
  await mount(el);
  el.open({ configuration: device.configuration });
  await baseDialogSettled(el);
  await flush();
  await el.updateComplete;
  return { el, api, unsubscribe };
}

function sectionIds(el: ESPHomeTroubleshootDialog): (string | null)[] {
  return [...el.shadowRoot!.querySelectorAll("[data-section]")].map((n) =>
    n.getAttribute("data-section")
  );
}

async function enterAndSave(el: ESPHomeTroubleshootDialog, value: string) {
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(".address-form input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLButtonElement>(".actions .btn--confirm")!.click();
  await flush();
  await el.updateComplete;
}

async function openAddressScreen(el: ESPHomeTroubleshootDialog): Promise<void> {
  el.shadowRoot!.querySelector<HTMLButtonElement>(
    "button.drill[data-section='use_address']"
  )!.click();
  await el.updateComplete;
}

describe("troubleshoot-dialog", () => {
  it("auto-runs the probe on open and renders the results", async () => {
    const { el, api } = await openDialog();
    expect(api.troubleshootDevice).toHaveBeenCalledWith("kitchen.yaml");
    const text = el.shadowRoot!.textContent!;
    expect(text).toContain("troubleshoot.result_dns_fail");
    expect(text).toContain("troubleshoot.result_mdns_silent");
    expect(text).toContain("troubleshoot.result_ping_fail");
  });

  it("renders inconclusive legs as neutral, not as verdicts", async () => {
    const { el } = await openDialog({
      troubleshootDevice: vi.fn().mockResolvedValue({
        ...RESULT,
        dns_inconclusive: true,
        mdns_inconclusive: true,
      }),
    });
    const text = el.shadowRoot!.textContent!;
    expect(text).toContain("troubleshoot.result_dns_inconclusive");
    expect(text).toContain("troubleshoot.result_mdns_inconclusive");
    expect(text).not.toContain("troubleshoot.result_dns_fail");
  });

  it("re-runs the probe from Check again", async () => {
    const { el, api } = await openDialog();
    const buttons = [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>("button")];
    buttons.find((b) => b.textContent!.includes("troubleshoot.check_again"))!.click();
    await flush();
    expect(api.troubleshootDevice).toHaveBeenCalledTimes(2);
  });

  it("keeps the docker advice off the HA add-on", async () => {
    const { el } = await openDialog(
      { serverInfo: { in_docker: true, ha_addon: true } },
      // The MAC marks the device as previously seen; an all-empty identity
      // would divert the diagnosis to never_flashed.
      makeConfiguredDevice({
        api_enabled: true,
        ip: "",
        mac_address: "AA:BB:CC:DD:EE:FF",
      })
    );
    const text = el.shadowRoot!.textContent!;
    expect(text).toContain("troubleshoot.mdns_dark_body");
    expect(text).not.toContain("troubleshoot.mdns_dark_docker_body");
  });

  it("renders sections from the decision tree, ending in use_address", async () => {
    const { el } = await openDialog();
    const ids = sectionIds(el);
    expect(ids).toContain("dns_fail");
    expect(ids).toContain("dynamic_ip");
    expect(ids[ids.length - 1]).toBe("use_address");
  });

  it("untracked opens explainer-only: no probe, no stream, no Check again", async () => {
    const { el, api } = await openDialog(
      {},
      makeConfiguredDevice({ name_add_mac_suffix: true })
    );
    expect(api.troubleshootDevice).not.toHaveBeenCalled();
    expect(api.subscribeDeviceReachability).not.toHaveBeenCalled();
    expect(sectionIds(el)).toEqual(["untracked"]);
    expect(el.shadowRoot!.textContent).not.toContain("troubleshoot.check_again");
  });

  it("reopening onto an untracked device stops the previous reconcile tick", async () => {
    const tracked = makeConfiguredDevice({ ip: "10.0.0.42" });
    const untracked = makeConfiguredDevice({
      name: "fleet",
      configuration: "fleet.yaml",
      name_add_mac_suffix: true,
    });
    const { el, api } = await openDialog({}, tracked);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._devices = [tracked, untracked];
    api.subscribeDeviceReachability.mockClear();
    vi.useFakeTimers();
    try {
      el.open({ configuration: "fleet.yaml" });
      await vi.advanceTimersByTimeAsync(5000);
      expect(api.subscribeDeviceReachability).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows only the untracked explainer for a mac-suffix config", async () => {
    const { el } = await openDialog(
      {},
      makeConfiguredDevice({ name_add_mac_suffix: true })
    );
    const ids = sectionIds(el);
    expect(ids).toEqual(["untracked"]);
    expect(el.shadowRoot!.querySelector(".address-form")).toBeNull();
  });

  it("keeps the manual-address fix on its own screen behind a drill row", async () => {
    const { el } = await openDialog();
    expect(el.shadowRoot!.querySelector(".address-form")).toBeNull();
    await openAddressScreen(el);
    expect(el.shadowRoot!.querySelector(".address-form input")).not.toBeNull();
    el.shadowRoot!.querySelector<HTMLButtonElement>(".back-button")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".address-form")).toBeNull();
  });

  it("surfaces a set use_address on the main screen and prefills the form", async () => {
    const { el } = await openDialog(
      {
        getConfig: vi
          .fn()
          .mockResolvedValue("wifi:\n  ssid: net\n  use_address: 10.0.0.7\n"),
      },
      makeConfiguredDevice({ address: "10.0.0.7" })
    );
    const ids = sectionIds(el);
    expect(ids).toContain("use_address_set");
    await openAddressScreen(el);
    const input = el.shadowRoot!.querySelector<HTMLInputElement>(".address-form input")!;
    expect(input.value).toBe("10.0.0.7");
  });

  it("never prefills a substitution or secret value the validator would reject", async () => {
    const { el } = await openDialog({
      getConfig: vi
        .fn()
        .mockResolvedValue(
          "substitutions:\n  static_ip: 10.0.0.42\n" +
            "wifi:\n  ssid: net\n  use_address: ${static_ip}\n"
        ),
    });
    await openAddressScreen(el);
    expect(el._existingAddress).toBe("${static_ip}");
    const input = el.shadowRoot!.querySelector<HTMLInputElement>(".address-form input")!;
    expect(input.value).toBe("");
  });

  it("removes an existing use_address from the address screen", async () => {
    const { el, api } = await openDialog(
      {
        getConfig: vi
          .fn()
          .mockResolvedValue("wifi:\n  ssid: net\n  use_address: 10.0.0.7\n"),
      },
      makeConfiguredDevice({ address: "10.0.0.7" })
    );
    await openAddressScreen(el);
    expect(el.shadowRoot!.textContent).toContain("troubleshoot.use_address_current");
    el.shadowRoot!.querySelector<HTMLButtonElement>(".btn--cancel")!.click();
    await flush();
    await el.updateComplete;
    const written = api.updateConfig.mock.calls[0][1] as string;
    expect(written).not.toContain("use_address");
    expect(el.shadowRoot!.textContent).toContain("troubleshoot.use_address_removed");
  });

  it("a packaged config with a custom domain stays a hint, not a diagnosis", async () => {
    const { el } = await openDialog(
      { getConfig: vi.fn().mockResolvedValue("packages:\n  base: !include x.yaml\n") },
      makeConfiguredDevice({ address: "kitchen.lan" })
    );
    const ids = sectionIds(el);
    expect(ids).not.toContain("use_address_set");
  });

  it("clears the heuristic when the YAML has no use_address", async () => {
    // A custom wifi domain shifts device.address without a use_address;
    // the exact read must not claim one is set.
    const { el } = await openDialog({}, makeConfiguredDevice({ address: "kitchen.lan" }));
    const ids = sectionIds(el);
    expect(ids).not.toContain("use_address_set");
  });

  it("saves a valid use_address through the YAML splice", async () => {
    const { el, api } = await openDialog();
    await openAddressScreen(el);
    await enterAndSave(el, "10.0.0.99");
    expect(api.getConfig).toHaveBeenCalledWith("kitchen.yaml");
    const written = api.updateConfig.mock.calls[0][1] as string;
    expect(written).toContain("use_address: 10.0.0.99");
    expect(el.shadowRoot!.textContent).toContain("troubleshoot.use_address_saved");
  });

  it("rejects an invalid address without touching the config", async () => {
    const { el, api } = await openDialog();
    await openAddressScreen(el);
    await enterAndSave(el, "not valid");
    expect(api.updateConfig).not.toHaveBeenCalled();
    expect(el.shadowRoot!.textContent).toContain("troubleshoot.use_address_invalid");
  });

  it("appends a deep-merging block when the network settings are packaged", async () => {
    const { el, api } = await openDialog(
      {
        getConfig: vi.fn().mockResolvedValue("packages:\n  base: !include x.yaml\n"),
      },
      makeConfiguredDevice({ ip: "10.0.0.42", loaded_integrations: ["wifi", "api"] })
    );
    await openAddressScreen(el);
    await enterAndSave(el, "10.0.0.99");
    const written = api.updateConfig.mock.calls[0][1] as string;
    expect(written).toContain("wifi:\n  use_address: 10.0.0.99");
    expect(el.shadowRoot!.textContent).toContain("troubleshoot.use_address_saved");
  });

  it("falls back to a copyable snippet for an include-valued network header", async () => {
    const { el, api } = await openDialog({
      getConfig: vi.fn().mockResolvedValue("wifi: !include wifi.yaml\n"),
    });
    await openAddressScreen(el);
    await enterAndSave(el, "10.0.0.99");
    expect(api.updateConfig).not.toHaveBeenCalled();
    // Bare key only: the include target is the section's mapping body,
    // so a section header pasted there would nest a level too deep.
    expect(el.shadowRoot!.querySelector(".snippet")!.textContent!.trim()).toBe(
      "use_address: 10.0.0.99"
    );
  });

  it("quotes an IPv6 literal in the copyable snippet", async () => {
    const { el } = await openDialog({
      getConfig: vi.fn().mockResolvedValue("wifi: !include wifi.yaml\n"),
    });
    await openAddressScreen(el);
    await enterAndSave(el, "fe80::1");
    expect(el.shadowRoot!.querySelector(".snippet")!.textContent!.trim()).toBe(
      'use_address: "fe80::1"'
    );
  });

  it("diagnoses a network-less YAML up front with no address drill", async () => {
    const { el } = await openDialog({
      getConfig: vi.fn().mockResolvedValue("esphome:\n  name: kitchen\napi:\n"),
    });
    const ids = sectionIds(el);
    expect(ids).toEqual(["no_network"]);
    expect(el.shadowRoot!.querySelector(".drill")).toBeNull();
  });

  it("refuses to guess a section when neither YAML nor compile shows one", async () => {
    // Packaged YAML keeps the tree inconclusive (the drill renders);
    // empty loaded_integrations then blocks the write at Save.
    const { el, api } = await openDialog({
      getConfig: vi.fn().mockResolvedValue("packages:\n  base: !include x.yaml\n"),
    });
    await openAddressScreen(el);
    await enterAndSave(el, "10.0.0.99");
    expect(api.updateConfig).not.toHaveBeenCalled();
    // Merged sources may still carry a network block; the copy must
    // say cannot-tell, not assert absence.
    expect(el.shadowRoot!.textContent).toContain(
      "troubleshoot.use_address_network_unknown"
    );
  });

  it("a same-device reopen keeps the stream and the last snapshot", async () => {
    const { el, api, unsubscribe } = await openDialog();
    const callback = api.subscribeDeviceReachability.mock.calls[0][1] as (
      e: unknown
    ) => void;
    const event = makeReachabilityEvent();
    callback(event);
    await el.updateComplete;
    el.open({ configuration: "kitchen.yaml" });
    await el.updateComplete;
    await flush();
    // The established stream survives (no drop, no resubscribe), and
    // the snapshot stays: the kept stream redelivers nothing, so
    // blanking would strand the section until the next signal change.
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(api.subscribeDeviceReachability).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._reachability).toBe(event);
  });

  it("drops the previous stream when reopened onto another device", async () => {
    const { el, api, unsubscribe } = await openDialog();
    const other = makeConfiguredDevice({
      name: "garage",
      configuration: "garage.yaml",
      ip: "10.0.0.43",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._devices = [...(el as any)._devices, other];
    el.open({ configuration: "garage.yaml" });
    await el.updateComplete;
    await flush();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(api.subscribeDeviceReachability).toHaveBeenLastCalledWith(
      "garage",
      expect.any(Function)
    );
  });

  it("unsubscribes the reachability stream on close", async () => {
    const { el, api, unsubscribe } = await openDialog();
    expect(api.subscribeDeviceReachability).toHaveBeenCalledWith(
      "kitchen",
      expect.any(Function)
    );
    el.shadowRoot!.querySelector("esphome-base-dialog")!.dispatchEvent(
      new CustomEvent("after-hide")
    );
    await el.updateComplete;
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
