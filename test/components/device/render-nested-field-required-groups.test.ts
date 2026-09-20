/**
 * A NESTED block's own ``required_groups`` (``wifi.eap``: at least one of
 * ``identity`` / ``certificate``) bind once the block is in use: an unmet one
 * is named inside the box, and an untouched optional block stays silent.
 */
import { describe, expect, it } from "vitest";
import {
  type ConfigEntry,
  ConfigEntryType,
} from "../../../src/api/types/config-entries.js";
import { renderNestedField } from "../../../src/components/device/config-entry-renderers.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";
import { makeRenderCtx } from "./_renderer-fixtures.js";

const eap: ConfigEntry = makeConfigEntry({
  key: "eap",
  type: ConfigEntryType.NESTED,
  required_groups: [{ kind: "at_least_one", keys: ["identity", "certificate"] }],
  config_entries: [
    makeConfigEntry({ key: "identity", label: "Identity" }),
    makeConfigEntry({ key: "certificate", label: "Certificate", group: "cert_and_key" }),
    makeConfigEntry({ key: "key", label: "Key", group: "cert_and_key" }),
    makeConfigEntry({ key: "username", label: "Username" }),
  ],
});

const rendered = (values: Record<string, unknown>): string =>
  JSON.stringify(
    renderNestedField(
      eap,
      ["eap"],
      makeRenderCtx(values, {
        overrides: { nestedOpenSections: new Set(["eap"]) },
      })
    )
  );

describe("renderNestedField with its own required groups", () => {
  it("names the unmet group once the block is in use", () => {
    expect(rendered({ eap: { username: "me" } })).toContain(
      "device.constraint_at_least_one"
    );
  });

  it("stays silent for an untouched optional block", () => {
    expect(rendered({})).not.toContain("device.constraint_");
    expect(rendered({ eap: {} })).not.toContain("device.constraint_");
  });

  it("clears once a member is set", () => {
    expect(rendered({ eap: { identity: "me" } })).not.toContain("device.constraint_");
  });

  it("names a half set all-or-none pair inside the block too", () => {
    const out = rendered({ eap: { certificate: "c.pem" } });
    expect(out).toContain("device.constraint_all_or_none");
    expect(out).not.toContain("device.constraint_at_least_one");
  });
});

describe("renderNestedField header description", () => {
  const PROSE = "**Required — set exactly one of:** `pwm`, `dac`.\n\nEnable PWM output.";
  const pwm: ConfigEntry = makeConfigEntry({
    key: "pwm",
    type: ConfigEntryType.NESTED,
    description: PROSE,
    config_entries: [makeConfigEntry({ key: "divider" })],
  });
  const header = (paths: string[]): string =>
    JSON.stringify(
      renderNestedField(
        pwm,
        ["pwm"],
        makeRenderCtx({}, { overrides: { reactiveConstraintPaths: new Set(paths) } })
      )
    );

  it("drops the baked constraint prose when a banner speaks for the block", () => {
    const out = header(["pwm"]);
    expect(out).toContain("Enable PWM output.");
    expect(out).not.toContain("set exactly one of");
  });

  it("keeps it for a block no reactive constraint covers", () => {
    expect(header([])).toContain("set exactly one of");
  });
});
