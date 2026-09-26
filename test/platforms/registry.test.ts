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
import type { FlasherStepView } from "../../src/platforms/platform-support.js";
import {
  installForMethod,
  platformFor,
  PLATFORMS,
  serialLogsFor,
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
    if (platform.install) {
      expect(installForMethod(platform.install.id)).toBe(platform.install);
    }
  });

  it.each(byId)(
    "%s has English copy for its install method and steps",
    (_id, platform) => {
      const install = platform.install;
      if (!install) return;
      const keys = [
        `dashboard.install_method_${install.methodKey}`,
        `dashboard.install_method_${install.methodKey}_desc`,
        ...Object.values<FlasherStepView>(install.steps).flatMap(detailKeys),
      ];
      if (install.downloadReady) {
        keys.push(install.downloadReady.titleKey, install.downloadReady.bodyKey);
      }
      for (const key of keys) {
        expect(english(key), `missing en.json key "${key}"`).toBeTruthy();
      }
    }
  );

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
    expect(ESP_SERIAL_LOGS).toEqual({ reset: "rts-pulse" });
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
