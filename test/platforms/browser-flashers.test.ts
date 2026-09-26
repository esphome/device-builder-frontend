import { describe, expect, it, vi } from "vitest";

const { isWebUsbSupported } = vi.hoisted(() => ({
  isWebUsbSupported: vi.fn(() => true),
}));
vi.mock("../../src/platforms/rp2/web-usb.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isWebUsbSupported,
}));

import type { FlasherStepView } from "../../src/components/firmware-install-dialog/browser-flasher.js";
import {
  BROWSER_FLASHERS,
  browserFlasherForMethod,
  browserFlasherForPlatform,
} from "../../src/platforms/browser-flashers.js";
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
  "nrf-dfu": "nrf52",
  "rp2-uf2": "rp2040",
  "rtl-ambz2": "rtl87xx",
};

describe("BROWSER_FLASHERS", () => {
  it("has one entry per installer id", () => {
    const ids = BROWSER_FLASHERS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(BROWSER_FLASHERS.map((f) => [f.id, f] as const))(
    "%s matches its platform and not ESP",
    (id, flasher) => {
      expect(flasher.matches(SAMPLE_PLATFORM[id])).toBe(true);
      expect(flasher.matches("esp32")).toBe(false);
      expect(browserFlasherForPlatform(SAMPLE_PLATFORM[id])).toBe(flasher);
      expect(browserFlasherForMethod(id)).toBe(flasher);
    }
  );

  it.each(BROWSER_FLASHERS.map((f) => [f.id, f] as const))(
    "%s has English copy for its method row and steps",
    (_id, flasher) => {
      const keys = [
        `dashboard.install_method_${flasher.methodKey}`,
        `dashboard.install_method_${flasher.methodKey}_desc`,
        ...Object.values<FlasherStepView>(flasher.steps).flatMap(detailKeys),
      ];
      if (flasher.downloadReady) {
        keys.push(flasher.downloadReady.titleKey, flasher.downloadReady.bodyKey);
      }
      for (const key of keys) {
        expect(english(key), `missing en.json key "${key}"`).toBeTruthy();
      }
    }
  );

  it("leaves ESP and unknown methods to the dialog", () => {
    expect(browserFlasherForPlatform("esp32")).toBeUndefined();
    expect(browserFlasherForMethod("web-serial")).toBeUndefined();
  });
});
