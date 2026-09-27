import { describe, expect, it, vi } from "vitest";

const { isWebUsbSupported } = vi.hoisted(() => ({
  isWebUsbSupported: vi.fn(() => true),
}));
vi.mock("../../src/platforms/rp2/web-usb.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isWebUsbSupported,
}));

import { english } from "../_en-json.js";
import { PLATFORM_INSTALLS } from "../_platform-installs.js";
import { ESP_SERIAL_LOGS } from "../../src/platforms/esp/serial-logs.js";
import type {
  AnyBrowserInstall,
  FlasherStepView,
  PlatformSupport,
} from "../../src/platforms/platform-support.js";
import {
  installFor,
  installForMethod,
  installOf,
  platformFor,
  PLATFORMS,
  serialLogsFor,
  serialLogsOf,
} from "../../src/platforms/registry.js";

// Every key a step detail can resolve to, with and without WebUSB.
function detailKeys(view: FlasherStepView): string[] {
  if (typeof view.detailKey === "string") return [view.detailKey];
  const keys: string[] = [];
  for (const webUsb of [true, false]) {
    isWebUsbSupported.mockReturnValue(webUsb);
    keys.push(view.detailKey());
  }
  return keys;
}

const SAMPLE_PLATFORM: Record<string, string> = {
  nrf52: "nrf52",
  rp2: "rp2040",
  rtl87xx: "rtl87xx",
};

// The chip of each split platform its flasher writes, and one it does not.
const CHIPS: Record<string, { takes: string; refuses: string }> = {
  rp2: { takes: "rp2040", refuses: "rp2350" },
  rtl87xx: { takes: "rtl8720c", refuses: "rtl8710b" },
};

const byId = PLATFORMS.map((p) => [p.id, p] as const);

describe("PLATFORMS", () => {
  it("has one entry per platform and per install method", () => {
    const ids = PLATFORMS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const methods = PLATFORM_INSTALLS.map((i) => i.id);
    expect(new Set(methods).size).toBe(methods.length);
  });

  it.each(byId)("%s matches its platform and not ESP", (id, platform) => {
    expect(platform.matches(SAMPLE_PLATFORM[id])).toBe(true);
    expect(platform.matches("esp32")).toBe(false);
    expect(platformFor(SAMPLE_PLATFORM[id])).toBe(platform);
    for (const install of platform.installs ?? []) {
      expect(installForMethod(install.id)).toBe(install);
    }
  });

  it.each(byId)("%s offers its install by chip", (id, platform) => {
    const sample = SAMPLE_PLATFORM[id];
    const [install] = platform.installs ?? [];
    const chips = CHIPS[id];
    // Every flasher of a platform that is more than one chip names its chips.
    for (const each of platform.installs ?? []) {
      expect(each.chips !== undefined).toBe(chips !== undefined);
    }
    if (!chips) {
      expect(installFor(sample, null)).toBe(install);
      expect(installFor(sample, "anything")).toBe(install);
      return;
    }
    expect(installFor(sample, chips.takes)).toBe(install);
    expect(installFor(sample, chips.refuses)).toBeUndefined();
    // Unknown is not offered: the chip has to be one a flasher writes.
    expect(installFor(sample, null)).toBeUndefined();
  });

  it("picks the flasher that writes the chip where a platform has several", () => {
    const first = { id: "first", chips: ["chip-a"] } as unknown as AnyBrowserInstall;
    const second = { id: "second", chips: ["chip-b"] } as unknown as AnyBrowserInstall;
    const platform: PlatformSupport = {
      id: "two-chips",
      matches: () => true,
      installs: [first, second],
    };
    expect(installOf(platform, "chip-a")).toBe(first);
    expect(installOf(platform, "chip-b")).toBe(second);
    expect(installOf(platform, "chip-c")).toBeUndefined();
    expect(installOf(platform, null)).toBeUndefined();
  });

  it("has no install for a platform without a descriptor", () => {
    expect(installFor("esp32", null)).toBeUndefined();
  });

  it.each(byId)(
    "%s has English copy for its install method and steps",
    (_id, platform) => {
      const keys = (platform.installs ?? []).flatMap(installCopyKeys);
      for (const key of keys) {
        expect(english(key), `missing en.json key "${key}"`).toBeTruthy();
      }
    }
  );

  function installCopyKeys(install: AnyBrowserInstall): string[] {
    const keys = [
      `dashboard.install_method_${install.methodKey}`,
      `dashboard.install_method_${install.methodKey}_desc`,
      ...Object.values<FlasherStepView>(install.steps).flatMap(detailKeys),
    ];
    if (install.downloadReady) {
      keys.push(install.downloadReady.titleKey, install.downloadReady.bodyKey);
    }
    return keys;
  }

  // The behaviour each platform's logs policy must keep: the RTS pulse only
  // where the port has a reset line, the line release only on RTL8720C kits,
  // their own reset for the Pico and nRF52, and Bluetooth only on nRF52.
  it.each([
    ["nrf52", { reset: "platform", releaseLinesAfterOpen: false, ble: true }],
    ["rp2", { reset: "platform", releaseLinesAfterOpen: false, ble: false }],
    ["rtl87xx", { reset: "rts-pulse", releaseLinesAfterOpen: true, ble: false }],
  ] as const)("%s keeps its logs policy", (id, expected) => {
    const logs = PLATFORMS.find((p) => p.id === id)?.logs;
    const reset = logs?.serial?.reset;
    expect({
      reset: typeof reset === "object" ? "platform" : reset,
      releaseLinesAfterOpen: logs?.serial?.releaseLinesAfterOpen ?? false,
      ble: logs?.ble !== undefined,
    }).toEqual(expected);
  });

  it("gives ESP, which has no descriptor, the RTS pulse", () => {
    expect(serialLogsFor("esp32")).toBe(ESP_SERIAL_LOGS);
    expect(serialLogsOf(undefined)).toBe(ESP_SERIAL_LOGS);
    expect(ESP_SERIAL_LOGS).toEqual({ reset: "rts-pulse" });
  });

  it("gives a platform without serial logs no reset, not ESP's pulse", () => {
    const bleOnly: PlatformSupport = { id: "ble-only", matches: () => true, logs: {} };
    expect(serialLogsOf(bleOnly)).toEqual({});
  });

  it("covers every registered platform in the logs policy table", () => {
    expect(PLATFORMS.map((p) => p.id).sort()).toEqual(["nrf52", "rp2", "rtl87xx"]);
  });

  it.each(["esp32", "esp8266", "bk72xx", null])(
    "leaves %s to the built-in paths",
    (platform) => {
      expect(platformFor(platform)).toBeUndefined();
    }
  );

  it("leaves ESP and unknown methods to the dialog", () => {
    expect(installForMethod("web-serial")).toBeUndefined();
    expect(installForMethod("carrier-pigeon")).toBeUndefined();
  });
});
