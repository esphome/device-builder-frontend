/**
 * @vitest-environment happy-dom
 *
 * Pins the section editor's packages-aware `depends_on_component`
 * presence wiring (#1632).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));
vi.mock("../../../src/components/device/config-entry-form.js", () => ({}));

import "../../_mock-webawesome.js";

import { identityLocalize, mount } from "../../_dom.js";
import { type ConfigEntry } from "../../../src/api/types/config-entries.js";
import { ESPHomeDeviceSectionConfig } from "../../../src/components/device/device-section-config.js";
import { flushDraft } from "../../../src/components/device/device-section-config/draft-and-delete.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const PACKAGES_YAML = "packages:\n  base: github://acme/base.yaml\nwifi:\n  ssid: foo\n";
const PLAIN_YAML = "wifi:\n  ssid: foo\n";

// ``configuration`` stays unset so mounting doesn't kick loadConfig.
function makeHost(yaml: string, entries: ConfigEntry[]) {
  const c = new ESPHomeDeviceSectionConfig();
  const inner = c as any;
  inner.sectionKey = "wifi";
  inner.yaml = yaml;
  inner._localize = identityLocalize;
  inner._config = { title: "wifi", entries };
  inner._presentComponents = new Set<string>(["wifi", "esphome"]);
  return { c, inner };
}

function formPresence(c: ESPHomeDeviceSectionConfig): ReadonlySet<string> {
  const form = c.shadowRoot!.querySelector("esphome-config-entry-form") as any;
  expect(form).not.toBeNull();
  return form.presentComponents;
}

describe("section-config merged-source presence", () => {
  it("widens the form's presentComponents with resolved components on a packages config", async () => {
    const { c, inner } = makeHost(PACKAGES_YAML, [makeConfigEntry({ key: "ssid" })]);
    inner._resolvedComponents = ["web_server", "esp32"];
    await mount(c);

    const present = formPresence(c);
    expect(present.has("web_server")).toBe(true);
    expect(present.has("wifi")).toBe(true);
  });

  it("widens after a late-arriving device row", async () => {
    const { c, inner } = makeHost(PACKAGES_YAML, [makeConfigEntry({ key: "ssid" })]);
    await mount(c);
    expect(formPresence(c).has("web_server")).toBe(false);

    inner._resolvedComponents = ["web_server"];
    await c.updateComplete;
    expect(formPresence(c).has("web_server")).toBe(true);
  });

  it("keeps the widened set identity-stable across no-op renders", async () => {
    const { c, inner } = makeHost(PACKAGES_YAML, [makeConfigEntry({ key: "ssid" })]);
    inner._resolvedComponents = ["web_server"];
    await mount(c);

    const first = formPresence(c);
    c.requestUpdate();
    await c.updateComplete;
    expect(formPresence(c)).toBe(first);
  });

  it("passes the literal set through unchanged on a plain config", async () => {
    const { c, inner } = makeHost(PLAIN_YAML, [makeConfigEntry({ key: "ssid" })]);
    inner._resolvedComponents = ["web_server"];
    await mount(c);

    expect(formPresence(c)).toBe(inner._presentComponents);
  });

  it("validates a dep-revealed required field with the same widened set", () => {
    const entries = [
      makeConfigEntry({ key: "ssid", required: true }),
      makeConfigEntry({
        key: "port",
        required: true,
        depends_on_component: "web_server",
      }),
    ];
    const { c, inner } = makeHost(PACKAGES_YAML, entries);
    inner.configuration = "device.yaml";
    inner.fromLine = 2;
    inner._values = { ssid: "foo" };

    // Hidden while the dep is unresolved: no phantom required error.
    flushDraft(c);
    expect(inner._fieldErrors.has("port")).toBe(false);

    // Resolved components reveal the field — validation enforces it.
    inner._resolvedComponents = ["web_server"];
    flushDraft(c);
    expect(inner._fieldErrors.has("port")).toBe(true);
  });
});
