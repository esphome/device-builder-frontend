/**
 * Pins that ``renderStringField`` mounts the inline ``<esphome-secret-picker>``
 * beside the input only for secret-eligible fields (WiFi SSID / password),
 * wires its ``secret-selected`` event into ``emitChange``, and leaves every
 * other string field's markup untouched.
 */
import { describe, expect, it, vi } from "vitest";
import {
  type ConfigEntry,
  ConfigEntryType,
} from "../../../src/api/types/config-entries.js";
import type { RenderCtx } from "../../../src/components/device/config-entry-renderers-shared.js";
import { renderStringField } from "../../../src/components/device/config-entry-renderers-shared.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";
import { makeRenderCtx } from "./_renderer-fixtures.js";

function makeEntry(key: string): ConfigEntry {
  return makeConfigEntry({ key, type: ConfigEntryType.STRING, label: key });
}

function makeCtx(
  sectionKey: string,
  values: Record<string, unknown> = {}
): { ctx: RenderCtx; emitChange: ReturnType<typeof vi.fn> } {
  const emitChange = vi.fn();
  const ctx = makeRenderCtx(values, {
    board: null,
    overrides: { sectionKey, emitChange, renderEntry: () => "<rendered>" },
  });
  return { ctx, emitChange };
}

const serialize = (tpl: unknown): string =>
  JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));

describe("renderStringField — inline secret picker", () => {
  it("mounts the picker for the WiFi SSID text field", () => {
    const { ctx } = makeCtx("wifi");
    const json = serialize(renderStringField(makeEntry("ssid"), "text", ["ssid"], ctx));
    expect(json).toContain("esphome-secret-picker");
    expect(json).toContain("field-input-row");
  });

  it("mounts the picker for the WiFi password field", () => {
    const { ctx } = makeCtx("wifi");
    const json = serialize(
      renderStringField(makeEntry("password"), "password", ["password"], ctx)
    );
    expect(json).toContain("esphome-secret-picker");
    expect(json).toContain("field-input-row");
  });

  it("mounts the picker for any concealed (password) field, even outside the allowlist", () => {
    // SECURE_STRING fields render with inputType "password"; the masker
    // already hides them, so they're secret-eligible without an allowlist
    // entry (e.g. ota[].password, api.encryption.key).
    const { ctx } = makeCtx("ota");
    const json = serialize(
      renderStringField(makeEntry("password"), "password", ["password"], ctx)
    );
    expect(json).toContain("esphome-secret-picker");
  });

  it("omits the picker for a non-eligible plain-text field", () => {
    const { ctx } = makeCtx("wifi");
    const json = serialize(
      renderStringField(makeEntry("output_power"), "text", ["output_power"], ctx)
    );
    expect(json).not.toContain("esphome-secret-picker");
    expect(json).not.toContain("field-input-row");
  });

  it("omits the picker for an ssid field outside the wifi section", () => {
    const { ctx } = makeCtx("sensor");
    const json = serialize(renderStringField(makeEntry("ssid"), "text", ["ssid"], ctx));
    expect(json).not.toContain("esphome-secret-picker");
  });

  it("hides the manual input in secret mode and suppresses the redundant hint", () => {
    const { ctx } = makeCtx("wifi", { ssid: "!secret wifi_ssid" });
    const json = serialize(renderStringField(makeEntry("ssid"), "text", ["ssid"], ctx));
    expect(json).toContain("esphome-secret-picker");
    expect(json).toContain("wifi_ssid");
    // Secret mode: no manual input row, no standalone hint below.
    expect(json).not.toContain("field-input-row");
    expect(json).not.toContain("device.value_from_secret");
  });

  it("keeps the standalone secret hint for a non-eligible field", () => {
    const { ctx } = makeCtx("sensor", { name: "!secret some_key" });
    const json = serialize(renderStringField(makeEntry("name"), "text", ["name"], ctx));
    expect(json).not.toContain("esphome-secret-picker");
    expect(json).toContain("device.value_from_secret");
  });
});
