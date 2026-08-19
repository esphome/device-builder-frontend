/**
 * Pins the migration nudge's per-change phrasing: kind picks the
 * sentence, versions collapse to their release line, and the removal /
 * required notes attach.
 */
import { describe, expect, it } from "vitest";

import type { MigrationChange } from "../../../src/api/types/editor.js";
import { describeMigrationChange } from "../../../src/components/device/config-migration-copy.js";
import { releaseLine } from "../../../src/util/version-mismatch.js";

const localize = (key: string, values?: Record<string, string | number>) =>
  `${key}${values ? JSON.stringify(values) : ""}`;

const base: MigrationChange = {
  kind: "field",
  scope: "sensor.sgp4x",
  old: "voc",
  new: "voc_index",
  since: "2026.8.0b1",
  removed_in: null,
  required: false,
};

describe("releaseLine", () => {
  it.each([
    ["2026.8.0b5", "2026.8"],
    ["2026.8.0", "2026.8"],
    ["2026.9.0-dev", "2026.9"],
    ["garbage", "garbage"],
  ])("%s -> %s", (version, expected) => {
    expect(releaseLine(version)).toBe(expected);
  });
});

describe("describeMigrationChange", () => {
  it("phrases by kind with the introducing release line", () => {
    expect(describeMigrationChange(localize, base)).toBe(
      'device.config_migration_change_field{"esphome":"ESPHome 2026.8","old":"voc","new":"voc_index","scope":"sensor.sgp4x"}'
    );
  });

  it("falls back to a bare ESPHome when the introducing version is unknown", () => {
    expect(describeMigrationChange(localize, { ...base, since: null })).toContain(
      '"esphome":"ESPHome"'
    );
  });

  it("appends the removal note", () => {
    expect(describeMigrationChange(localize, { ...base, removed_in: "2027.2.0" })).toBe(
      'device.config_migration_change_field{"esphome":"ESPHome 2026.8","old":"voc","new":"voc_index","scope":"sensor.sgp4x"} device.config_migration_change_removed_in{"removed_in":"2027.2"}'
    );
  });

  it("the required note wins over the removal note", () => {
    const text = describeMigrationChange(localize, {
      ...base,
      removed_in: "2027.2.0",
      required: true,
    });
    expect(text).toContain("device.config_migration_change_required");
    expect(text).not.toContain("config_migration_change_removed_in");
  });
});
