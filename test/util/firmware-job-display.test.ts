import { describe, expect, it } from "vitest";
import { JobSource, JobStatus, JobType } from "../../src/api/types.js";
import type { ConfiguredDevice, FirmwareJob } from "../../src/api/types.js";
import type { LocalizeFunc } from "../../src/common/localize.js";
import { firmwareJobDisplayName } from "../../src/util/firmware-job-display.js";

/**
 * Build a structurally-accurate ``FirmwareJob`` for tests.
 *
 * Mirrors the wire shape so a future addition / rename to the
 * interface makes the helper fail to compile rather than
 * silently drift behind a forced cast.
 */
function job(overrides: Partial<FirmwareJob> = {}): FirmwareJob {
  return {
    job_id: "job-1",
    configuration: "kitchen.yaml",
    job_type: JobType.INSTALL,
    status: JobStatus.RUNNING,
    created_at: "2026-05-11T00:00:00Z",
    started_at: null,
    completed_at: null,
    exit_code: null,
    output: [],
    error: null,
    port: "",
    new_name: "",
    progress: null,
    source: JobSource.LOCAL,
    source_pin_sha256: "",
    source_label: "",
    source_esphome_version: "",
    remote_peer: "",
    remote_peer_label: "",
    device_name: "",
    device_friendly_name: "",
    ...overrides,
  };
}

/**
 * Minimal ``LocalizeFunc`` — returns the key verbatim so the
 * tests assert on the discriminator without coupling to copy.
 *
 * The display helper only calls ``localize`` for the
 * ``build_env_label`` fallback today; the receiver-side branch
 * never falls through to it, so a key-verbatim stub keeps the
 * test focused on the title-resolution logic.
 */
const localize: LocalizeFunc = ((key: string) => key) as LocalizeFunc;

const NO_DEVICES: ConfiguredDevice[] = [];

describe("firmwareJobDisplayName (receiver-side remote-build jobs)", () => {
  it("prefers device_friendly_name when set", () => {
    const j = job({
      remote_peer: "alpha-dashboard",
      configuration: ".esphome/.remote_builds/alpha-dashboard/kitchen/kitchen.yaml",
      device_name: "kitchen",
      device_friendly_name: "AC Float Monitor 32",
    });

    expect(firmwareJobDisplayName(j, NO_DEVICES, localize)).toBe("AC Float Monitor 32");
  });

  it("falls back to device_name when friendly_name is empty", () => {
    const j = job({
      remote_peer: "alpha-dashboard",
      configuration: ".esphome/.remote_builds/alpha-dashboard/kitchen/kitchen.yaml",
      device_name: "kitchen",
      device_friendly_name: "",
    });

    expect(firmwareJobDisplayName(j, NO_DEVICES, localize)).toBe("kitchen");
  });

  it("falls back to the path's device segment when both display fields are empty", () => {
    /* Older offloader didn't set the NotRequired wire fields;
       the receiver's title surface degrades to the path's
       device segment rather than rendering the cryptic full
       configuration path. */
    const j = job({
      remote_peer: "alpha-dashboard",
      configuration: ".esphome/.remote_builds/alpha-dashboard/kitchen/kitchen.yaml",
      device_name: "",
      device_friendly_name: "",
    });

    expect(firmwareJobDisplayName(j, NO_DEVICES, localize)).toBe("kitchen");
  });

  it("ignores the local Device list for receiver-side jobs", () => {
    /* The receiver has its own Device list for its own
       locally-configured YAMLs but those configurations don't
       match the remote-build path. A stray same-stem entry
       must NOT shadow the offloader-sent name. */
    const j = job({
      remote_peer: "alpha-dashboard",
      configuration: ".esphome/.remote_builds/alpha-dashboard/kitchen/kitchen.yaml",
      device_friendly_name: "AC Float Monitor 32",
    });
    const decoyDevices: ConfiguredDevice[] = [
      {
        name: "kitchen",
        friendly_name: "Some Other Kitchen Device",
        configuration: "kitchen.yaml",
      } as ConfiguredDevice,
    ];

    expect(firmwareJobDisplayName(j, decoyDevices, localize)).toBe("AC Float Monitor 32");
  });
});

describe("firmwareJobDisplayName (locally-submitted jobs)", () => {
  it("prefers the configured device's friendly_name", () => {
    const j = job({ configuration: "kitchen.yaml" });
    const devices: ConfiguredDevice[] = [
      {
        name: "kitchen",
        friendly_name: "Kitchen Sensor",
        configuration: "kitchen.yaml",
      } as ConfiguredDevice,
    ];

    expect(firmwareJobDisplayName(j, devices, localize)).toBe("Kitchen Sensor");
  });

  it("falls back to configuration when no matching device", () => {
    const j = job({ configuration: "unknown.yaml" });

    expect(firmwareJobDisplayName(j, NO_DEVICES, localize)).toBe("unknown.yaml");
  });
});
