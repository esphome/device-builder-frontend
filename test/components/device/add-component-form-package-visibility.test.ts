/**
 * @vitest-environment happy-dom
 *
 * Pins the add form's packages-aware `depends_on_component` presence
 * binding (#1632).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("../../../src/components/device/config-entry-form.js", () => ({}));

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
  });

  it("widens the inner form's presentComponents on a packages config", async () => {
    const el = await mountAddComponentForm({
      component: uptime,
      yaml: PACKAGES_YAML,
      resolvedComponents: ["web_server", "esp32"],
    });
    expect(formPresence(el).has("web_server")).toBe(true);
  });

  it("keeps the literal scan on a plain config", async () => {
    const el = await mountAddComponentForm({
      component: uptime,
      yaml: "esphome:\n  name: foo\n",
      resolvedComponents: ["web_server"],
    });
    expect(formPresence(el).has("web_server")).toBe(false);
    expect(formPresence(el).has("esphome")).toBe(true);
  });
});
