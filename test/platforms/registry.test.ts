import { describe, expect, it, vi } from "vitest";

const { isWebUsbSupported } = vi.hoisted(() => ({
  isWebUsbSupported: vi.fn(() => true),
}));
vi.mock("../../src/platforms/rp2/web-usb.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isWebUsbSupported,
}));

import type { FlasherStepView } from "../../src/platforms/platform-support.js";
import {
  installForMethod,
  platformFor,
  PLATFORMS,
} from "../../src/platforms/registry.js";
import enMessages from "../../src/translations/en.json";

// A dotted key's English copy, or undefined when en.json lacks it.
function english(key: string): unknown {
  let node: unknown = enMessages;
  for (const part of key.split(".")) {
    node =
      typeof node === "object" && node !== null ? Reflect.get(node, part) : undefined;
  }
  return node;
}

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
    const methods = PLATFORMS.flatMap((p) => (p.install ? [p.install.id] : []));
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

  it.each(byId)("%s has a well-formed logs policy", (_id, platform) => {
    const serial = platform.logs?.serial;
    if (serial) {
      expect(typeof serial.pulseResets).toBe("boolean");
      expect(typeof serial.releasesLinesAfterOpen).toBe("boolean");
    }
    const ble = platform.logs?.ble;
    if (ble) {
      expect(ble.available).toBeTypeOf("function");
      expect(ble.pick).toBeTypeOf("function");
      expect(ble.attach).toBeTypeOf("function");
    }
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
