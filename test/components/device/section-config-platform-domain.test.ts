/**
 * @vitest-environment happy-dom
 *
 * A bare platform-domain section (`switch:` with no items) misses the
 * catalog like an unknown key, but must load as the empty-platform state
 * with an add-component deep-link — not as an external component
 * (esphome/device-builder#2218).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import type { ESPHomeAPI } from "../../../src/api/index.js";
import {
  ComponentCategory,
  type ComponentCatalogEntry,
} from "../../../src/api/types/components.js";
import { ESPHomeDeviceSectionConfig } from "../../../src/components/device/device-section-config.js";
import { loadConfig } from "../../../src/components/device/device-section-config/loading.js";
import { _clearComponentCache } from "../../../src/util/component-name-cache.js";
import { makeComponentEntry } from "../../util/_make-component-entry.js";

const SLIMS: ComponentCatalogEntry[] = [
  makeComponentEntry("switch.gpio", { category: ComponentCategory.SWITCH }),
];

// One catalog shape for the whole file — loadCatalog memoizes its promise
// for the module's lifetime, so per-test catalogs would collide.
const api = {
  getComponents: async () => ({ components: SLIMS }),
  getComponentBodies: async () => ({}),
} as unknown as ESPHomeAPI;

/* eslint-disable @typescript-eslint/no-explicit-any */
function host(sectionKey: string, yaml: string) {
  const c = new ESPHomeDeviceSectionConfig();
  const inner = c as any;
  inner._api = api;
  inner.yaml = yaml;
  inner.sectionKey = sectionKey;
  inner._localize = (key: string) => key;
  return { c, inner };
}

describe("bare platform-domain section (#2218)", () => {
  beforeEach(() => _clearComponentCache());

  it("loads an empty switch: as a platform domain, not an external component", async () => {
    const { c, inner } = host("switch", "switch:\n");
    await loadConfig(c);
    expect(inner._isPlatformDomain).toBe(true);
    expect(inner._isUnknown).toBe(false);
    expect(inner._config.title).toBe("switch");
  });

  it("still loads a genuinely unknown key as external", async () => {
    const { c, inner } = host("sendx", "sendx:\n");
    await loadConfig(c);
    expect(inner._isPlatformDomain).toBe(false);
    expect(inner._isUnknown).toBe(true);
  });

  it("the add affordance deep-links the add-component dialog to the domain", () => {
    const { c, inner } = host("switch", "switch:\n");
    const seen: unknown[] = [];
    c.addEventListener("request-add-component", (e) =>
      seen.push((e as CustomEvent).detail)
    );
    inner._onAddPlatform();
    expect(seen).toEqual([{ domain: "switch" }]);
  });
});
