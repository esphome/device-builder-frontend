/**
 * Pins the migration nudge's per-change phrasing: kind picks the
 * sentence, versions collapse to their release line, config spellings
 * come back as code runs, and the removal / required notes attach.
 */
import { describe, expect, it } from "vitest";

import type { MigrationChange } from "../../../src/api/types/editor.js";
import { migrationChangeSegments } from "../../../src/components/device/config-migration-copy.js";
import { releaseLine } from "../../../src/util/version-mismatch.js";

const localize = (key: string, values?: Record<string, string | number>) =>
  `${key}${values ? Object.values(values).join("|") : ""}`;

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

describe("migrationChangeSegments", () => {
  it("phrases by kind with the introducing release line, spellings as code runs", () => {
    expect(migrationChangeSegments(localize, base)).toEqual([
      "device.config_migration_change_fieldESPHome 2026.8|",
      { code: "voc" },
      "|",
      { code: "voc_index" },
      "|",
      { code: "sensor.sgp4x" },
    ]);
  });

  it("falls back to a bare ESPHome when the introducing version is unknown", () => {
    expect(migrationChangeSegments(localize, { ...base, since: null })[0]).toContain(
      "ESPHome|"
    );
  });

  it("appends the removal note", () => {
    const segments = migrationChangeSegments(localize, {
      ...base,
      removed_in: "2027.2.0",
    });
    expect(segments[segments.length - 1]).toBe(
      " device.config_migration_change_removed_in2027.2"
    );
  });

  it("the required note wins over the removal note", () => {
    const segments = migrationChangeSegments(localize, {
      ...base,
      removed_in: "2027.2.0",
      required: true,
    });
    expect(segments[segments.length - 1]).toBe(
      " device.config_migration_change_required"
    );
    expect(JSON.stringify(segments)).not.toContain("removed_in");
  });
});
