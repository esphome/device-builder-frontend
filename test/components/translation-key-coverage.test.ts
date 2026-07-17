import { describe, expect, it } from "vitest";
import type { VersionMatchPolicy } from "../../src/api/types/event-subscription.js";
import { JobType } from "../../src/api/types/firmware-jobs.js";
import type { CommandType } from "../../src/components/command-dialog.js";
import enMessages from "../../src/translations/en.json";

// Pin enum-driven dynamic translation keys to en.json so a new enum member
// can't ship without English copy (cf. #636 / #634). Runtime enums drive
// it.each; string unions use `Record<Union, true>` so tsc fails when a member
// is added without being listed, forcing the en.json check.

const firmwareJobs = (enMessages as { firmware_jobs: Record<string, string> })
  .firmware_jobs;
const settings = (enMessages as { settings: Record<string, string> }).settings;
const command = (enMessages as { command: Record<string, string> }).command;

describe("firmware job type translation keys", () => {
  // <esphome-firmware-jobs-dialog> renders `firmware_jobs.type_${job.job_type}`.
  it.each(Object.values(JobType))("defines a label for the %s job type", (jobType) => {
    const key = `type_${jobType}`;
    expect(firmwareJobs[key], `missing en.json key "firmware_jobs.${key}"`).toBeTruthy();
  });
});

describe("command dialog title translation keys", () => {
  // <esphome-command-dialog> renders `command.${this._commandType}_title`.
  const COMMAND_TYPES: Record<CommandType, true> = {
    install: true,
    compile: true,
    validate: true,
    clean: true,
    reset: true,
    rename: true,
  };

  it.each(Object.keys(COMMAND_TYPES))(
    "defines a title for the %s command",
    (commandType) => {
      const key = `${commandType}_title`;
      expect(command[key], `missing en.json key "command.${key}"`).toBeTruthy();
    }
  );
});

describe("offloader version match policy translation keys", () => {
  // Build-offload settings render `settings.offloader_version_match_policy_${p}`
  // and its `_desc` variant.
  const POLICIES: Record<VersionMatchPolicy, true> = {
    any: true,
    release: true,
    exact: true,
    exact_required: true,
  };

  it.each(Object.keys(POLICIES))(
    "defines a label and description for the %s policy",
    (policy) => {
      const label = `offloader_version_match_policy_${policy}`;
      const desc = `${label}_desc`;
      expect(settings[label], `missing en.json key "settings.${label}"`).toBeTruthy();
      expect(settings[desc], `missing en.json key "settings.${desc}"`).toBeTruthy();
    }
  );
});
