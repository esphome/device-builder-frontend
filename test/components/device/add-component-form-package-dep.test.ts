/**
 * @vitest-environment happy-dom
 *
 * Pins the packages-aware dependency gate: a dep the literal-name scan
 * flags missing (esp32 supplied by a remote package) is cleared by the
 * device's backend-resolved component list.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import type { ESPHomeAPI } from "../../../src/api/index.js";
import type { ESPHomeAddComponentForm } from "../../../src/components/device/add-component-form.js";
import { _clearComponentCache } from "../../../src/util/component-name-cache.js";
import { _clearProvidesCache } from "../../../src/util/provides-cache.js";
import { makeComponentEntry } from "../../util/_make-component-entry.js";
import { depsBanner, mountAddComponentForm } from "./_add-component-form-host.js";

const bluetoothProxy = makeComponentEntry("bluetooth_proxy", {
  name: "Bluetooth Proxy",
  dependencies: ["api", "esp32"],
});

const PACKAGES_YAML =
  "packages:\n  base: github://acme/device.yaml\napi:\n  encryption:\n    key: k\n";

function mountForm(
  yaml: string,
  resolvedComponents: readonly string[]
): Promise<ESPHomeAddComponentForm> {
  const getComponents = vi.fn().mockResolvedValue({
    components: [],
    categories: [],
    total: 0,
    offset: 0,
    limit: 200,
  });
  return mountAddComponentForm({
    component: bluetoothProxy,
    yaml,
    resolvedComponents,
    api: { getComponents } as unknown as ESPHomeAPI,
  });
}

describe("add-component-form package-resolved dependency", () => {
  afterEach(() => {
    _clearComponentCache();
    _clearProvidesCache();
    document.body.innerHTML = "";
  });

  it("clears the banner when the resolved components satisfy the dep", async () => {
    const el = await mountForm(PACKAGES_YAML, ["api", "esp32", "wifi"]);
    expect(depsBanner(el)).toBeNull();
  });

  it("keeps the banner when the resolved components lack the dep", async () => {
    const el = await mountForm(PACKAGES_YAML, ["api", "esp8266", "wifi"]);
    expect(depsBanner(el)).not.toBeNull();
  });
});
