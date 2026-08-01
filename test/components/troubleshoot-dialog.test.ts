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
import type { DeviceTroubleshootResult } from "../../src/api/types/troubleshoot.js";
import { ESPHomeTroubleshootDialog } from "../../src/components/troubleshoot-dialog.js";

const RESULT: DeviceTroubleshootResult = {
  configuration: "kitchen.yaml",
  address: "kitchen.local",
  icmp_available: true,
  zeroconf_running: true,
  dns_resolved: false,
  dns_addresses: [],
  dns_had_cached_failure: true,
  dns_inconclusive: false,
  mdns_addresses: [],
  mdns_has_cached_trace: false,
  mdns_has_live_anchor_ptr: false,
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
      makeConfiguredDevice({ api_enabled: true, ip: "" })
    );
    const text = el.shadowRoot!.textContent!;
    expect(text).toContain("troubleshoot.mdns_dark_body");
    expect(text).not.toContain("troubleshoot.mdns_dark_docker_body");
  });

  it("renders sections from the decision tree, ending in use_address", async () => {
    const { el } = await openDialog();
    const ids = [...el.shadowRoot!.querySelectorAll("[data-section]")].map((n) =>
      n.getAttribute("data-section")
    );
    expect(ids).toContain("dns_fail");
    expect(ids).toContain("dynamic_ip");
    expect(ids[ids.length - 1]).toBe("use_address");
  });

  it("shows only the untracked explainer for a mac-suffix config", async () => {
    const { el } = await openDialog(
      {},
      makeConfiguredDevice({ name_add_mac_suffix: true })
    );
    const ids = [...el.shadowRoot!.querySelectorAll("[data-section]")].map((n) =>
      n.getAttribute("data-section")
    );
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
    const ids = [...el.shadowRoot!.querySelectorAll("[data-section]")].map((n) =>
      n.getAttribute("data-section")
    );
    expect(ids).toContain("use_address_set");
    await openAddressScreen(el);
    const input = el.shadowRoot!.querySelector<HTMLInputElement>(".address-form input")!;
    expect(input.value).toBe("10.0.0.7");
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
    el.shadowRoot!.querySelector<HTMLButtonElement>(".btn--remove")!.click();
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
    const ids = [...el.shadowRoot!.querySelectorAll("[data-section]")].map((n) =>
      n.getAttribute("data-section")
    );
    expect(ids).not.toContain("use_address_set");
  });

  it("clears the heuristic when the YAML has no use_address", async () => {
    // A custom wifi domain shifts device.address without a use_address;
    // the exact read must not claim one is set.
    const { el } = await openDialog({}, makeConfiguredDevice({ address: "kitchen.lan" }));
    const ids = [...el.shadowRoot!.querySelectorAll("[data-section]")].map((n) =>
      n.getAttribute("data-section")
    );
    expect(ids).not.toContain("use_address_set");
  });

  it("saves a valid use_address through the YAML splice", async () => {
    const { el, api } = await openDialog();
    await openAddressScreen(el);
    const input = el.shadowRoot!.querySelector<HTMLInputElement>(".address-form input")!;
    input.value = "10.0.0.99";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLButtonElement>(".actions .btn--confirm")!.click();
    await flush();
    await el.updateComplete;
    expect(api.getConfig).toHaveBeenCalledWith("kitchen.yaml");
    const written = api.updateConfig.mock.calls[0][1] as string;
    expect(written).toContain("use_address: 10.0.0.99");
    expect(el.shadowRoot!.textContent).toContain("troubleshoot.use_address_saved");
  });

  it("rejects an invalid address without touching the config", async () => {
    const { el, api } = await openDialog();
    await openAddressScreen(el);
    const input = el.shadowRoot!.querySelector<HTMLInputElement>(".address-form input")!;
    input.value = "not valid";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLButtonElement>(".actions .btn--confirm")!.click();
    await flush();
    await el.updateComplete;
    expect(api.updateConfig).not.toHaveBeenCalled();
    expect(el.shadowRoot!.textContent).toContain("troubleshoot.use_address_invalid");
  });

  it("falls back to a copyable snippet when the network block is packaged", async () => {
    const { el } = await openDialog({
      getConfig: vi.fn().mockResolvedValue("packages:\n  base: !include x.yaml\n"),
    });
    await openAddressScreen(el);
    const input = el.shadowRoot!.querySelector<HTMLInputElement>(".address-form input")!;
    input.value = "10.0.0.99";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLButtonElement>(".actions .btn--confirm")!.click();
    await flush();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".snippet")!.textContent).toContain(
      "use_address: 10.0.0.99"
    );
  });

  it("does not double-subscribe while an attempt is in flight", async () => {
    let resolveSub: (v: { unsubscribe: () => void }) => void;
    const pending = new Promise<{ unsubscribe: () => void }>((r) => {
      resolveSub = r;
    });
    const { el, api } = await openDialog({
      subscribeDeviceReachability: vi.fn().mockReturnValue(pending),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._reconcileSubscription();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._reconcileSubscription();
    expect(api.subscribeDeviceReachability).toHaveBeenCalledTimes(1);
    resolveSub!({ unsubscribe: vi.fn() });
    await flush();
  });

  it("drops the previous stream when reopened", async () => {
    const { el, unsubscribe } = await openDialog();
    el.open({ configuration: "kitchen.yaml" });
    await el.updateComplete;
    expect(unsubscribe).toHaveBeenCalledTimes(1);
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
