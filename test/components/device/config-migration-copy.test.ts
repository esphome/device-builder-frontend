/**
 * Pins the migration nudge's per-change phrasing: kind picks the
 * sentence, config spellings come back as code runs, and the version /
 * removal / required notes attach in their fixed order.
 */
import { describe, expect, it } from "vitest";

import type { MigrationChange } from "../../../src/api/types/editor.js";
import { migrationChangeSegments } from "../../../src/components/device/config-migration-copy.js";

const localize = (key: string, values?: Record<string, string | number>) =>
  `${key}${values ? Object.values(values).join("|") : ""}`;

const base: MigrationChange = {
  kind: "field",
  scope: "sensor.sgp4x",
  old: "voc",
  new: "voc_index",
  since: null,
  removed_in: null,
  required: false,
};

describe("migrationChangeSegments", () => {
  it("phrases by kind with the spellings as code runs", () => {
    expect(migrationChangeSegments(localize, base)).toEqual([
      "device.config_migration_change_field",
      { code: "voc" },
      "|",
      { code: "voc_index" },
      "|",
      { code: "sensor.sgp4x" },
    ]);
  });

  it.each([
    [
      "since only",
      { since: "2026.8.0b1" },
      " device.config_migration_change_since2026.8",
    ],
    [
      "since and removal",
      { since: "2026.8.0b1", removed_in: "2027.2.0" },
      " device.config_migration_change_since_removed_in2026.8|2027.2",
    ],
    [
      "removal only",
      { removed_in: "2027.2.0" },
      " device.config_migration_change_removed_in2027.2",
    ],
    [
      "required replaces the removal note",
      { since: "2026.8.0b1", removed_in: "2027.2.0", required: true },
      " device.config_migration_change_since2026.8 device.config_migration_change_required",
    ],
  ])("%s", (_name, overrides, tail) => {
    const segments = migrationChangeSegments(localize, { ...base, ...overrides });
    expect(segments[segments.length - 1]).toBe(tail);
  });
});
