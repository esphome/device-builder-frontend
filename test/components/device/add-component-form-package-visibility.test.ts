/**
 * @vitest-environment happy-dom
 *
 * Pins the add form's packages-aware `depends_on_component` visibility
 * (#1632): the inner form's `presentComponents` binding is widened by
 * the resolved components on a merged-source config only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("../../../src/components/device/config-entry-form.js", () => ({}));

import type { ESPHomeAPI } from "../../../src/api/index.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import type { ESPHomeAddComponentForm } from "../../../src/components/device/add-component-form.js";
import { _clearComponentCache } from "../../../src/util/component-name-cache.js";
import { _clearProvidesCache } from "../../../src/util/provides-cache.js";
import { makeComponentEntry } from "../../util/_make-component-entry.js";
import { makeConfigEntry } from "../../util/_make-config-entry.js";
import { mountAddComponentForm } from "./_add-component-form-host.js";

const uptime = makeComponentEntry("sensor.uptime", {
  name: "Uptime",
  config_entries: [
    makeConfigEntry({ key: "name", type: ConfigEntryType.STRING, required: true }),
    makeConfigEntry({ key: "web", depends_on_component: "web_server" }),
  ],
});

const PACKAGES_YAML = "packages:\n  base: github://acme/base.yaml\n";

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
    component: uptime,
    yaml,
    resolvedComponents,
    api: { getComponents } as unknown as ESPHomeAPI,
  });
}

function formPresence(el: ESPHomeAddComponentForm): ReadonlySet<string> {
  const form = el.shadowRoot!.querySelector("esphome-config-entry-form") as unknown as {
    presentComponents: ReadonlySet<string>;
  };
  expect(form).not.toBeNull();
  return form.presentComponents;
}

describe("add-component-form package-resolved presence", () => {
  afterEach(() => {
    _clearComponentCache();
    _clearProvidesCache();
    document.body.innerHTML = "";
  });

  it("widens the inner form's presentComponents on a packages config", async () => {
    const el = await mountForm(PACKAGES_YAML, ["web_server", "esp32"]);
    expect(formPresence(el).has("web_server")).toBe(true);
  });

  it("keeps the literal scan on a plain config", async () => {
    const el = await mountForm("esphome:\n  name: foo\n", ["web_server"]);
    expect(formPresence(el).has("web_server")).toBe(false);
    expect(formPresence(el).has("esphome")).toBe(true);
  });
});
