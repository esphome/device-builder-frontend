import { describe, expect, it } from "vitest";
import type { VersionMatchPolicy } from "../../src/api/types/event-subscription.js";
import { JobStatus, JobType } from "../../src/api/types/firmware-jobs.js";
import type { CommandType } from "../../src/components/command-dialog.js";
import enMessages from "../../src/translations/en.json";

// Several UI surfaces resolve their label via a *dynamic* translation key
// built from a backend enum value — ``localize(`firmware_jobs.type_${job.job_type}`)``,
// ``localize(`settings.remote_build_status_${job.status}`)`` and friends.
// When the source enum gains a member without a matching en.json key, the
// label silently falls back to English (or the raw value) in every locale —
// the exact mixed-language regression that bit the component-category panel
// (device-builder#1210, fixed in the sibling category-coverage test).
//
// Pin every enum-driven dynamic key so a newly added enum member can't ship
// without its English copy. The runtime enums (JobType / JobStatus) drive a
// data assertion; the string-union types (CommandType / VersionMatchPolicy)
// can't be iterated at runtime, so a ``Record<Union, true>`` makes tsc fail
// to compile this file the moment a union member is added without being
// listed here — which then forces the en.json check below.

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

describe("remote build job status translation keys", () => {
  // <esphome-remote-build-job-dialog> renders
  // `settings.remote_build_status_${job.status}` in the per-job status pill.
  it.each(Object.values(JobStatus))("defines a label for the %s job status", (status) => {
    const key = `remote_build_status_${status}`;
    expect(settings[key], `missing en.json key "settings.${key}"`).toBeTruthy();
  });
});

describe("remote build submit target translation keys", () => {
  // The same dialog renders `settings.remote_build_submit_target_${job.target}`.
  // `RemoteBuildSubmitTarget` is the COMPILE | UPLOAD subset of JobType.
  it.each([JobType.COMPILE, JobType.UPLOAD])(
    "defines a label for the %s submit target",
    (target) => {
      const key = `remote_build_submit_target_${target}`;
      expect(settings[key], `missing en.json key "settings.${key}"`).toBeTruthy();
    }
  );
});

describe("command dialog title translation keys", () => {
  // <esphome-command-dialog> renders `command.${this._commandType}_title`.
  // CommandType is a string union — the Record makes tsc reject this file if a
  // member is added without being listed, so coverage can't drift unnoticed.
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
  // The build-offload settings section renders both
  // `settings.offloader_version_match_policy_${p}` (the option label) and
  // `settings.offloader_version_match_policy_${p}_desc` (the selected
  // description). VersionMatchPolicy is a string union — see the Record note
  // above.
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
