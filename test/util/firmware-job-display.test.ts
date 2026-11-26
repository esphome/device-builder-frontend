import { describe, expect, it } from "vitest";
import { identityLocalize } from "../_dom.js";
import { makeFirmwareJob } from "../_make-firmware-job.js";
import type { ConfiguredDevice } from "../../src/api/types/devices.js";
import type { FirmwareJob } from "../../src/api/types/firmware-jobs.js";
import { JobStatus, JobType } from "../../src/api/types/firmware-jobs.js";
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
  return makeFirmwareJob({
    job_type: JobType.INSTALL,
    status: JobStatus.RUNNING,
    port: "",
    created_at: "2026-05-11T00:00:00Z",
    ...overrides,
  });
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
const localize: LocalizeFunc = identityLocalize as LocalizeFunc;

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

describe("firmwareJobDisplayName (nested device configurations)", () => {
  it("names a remote_peer job on a nested local configuration by its file stem", () => {
    /* Only the ``.esphome/.remote_builds/`` prefix marks a received
       build; a nested device's folder (``lights``) is not its name. */
    const j = job({
      remote_peer: "alpha-dashboard",
      configuration: "devices/lights/desk-led.yaml",
      device_name: "",
      device_friendly_name: "",
    });

    expect(firmwareJobDisplayName(j, NO_DEVICES, localize)).toBe("desk-led");
  });

  it("keeps the configuration when its stem is empty", () => {
    const j = job({
      remote_peer: "alpha-dashboard",
      configuration: ".yaml",
      device_name: "",
      device_friendly_name: "",
    });

    expect(firmwareJobDisplayName(j, NO_DEVICES, localize)).toBe(".yaml");
  });
});

describe("firmwareJobDisplayName (rename jobs)", () => {
  const rename = (configuration: string, new_name = "lamp") =>
    job({ job_type: JobType.RENAME, configuration, new_name });

  it("labels the transition with the old and new names", () => {
    expect(firmwareJobDisplayName(rename("desk.yaml"), NO_DEVICES, localize)).toBe(
      "desk → lamp"
    );
  });

  it("uses the file stem of a nested configuration, not its folder", () => {
    expect(
      firmwareJobDisplayName(rename("devices/lights/desk.yaml"), NO_DEVICES, localize)
    ).toBe("desk → lamp");
  });

  it("prefixes the friendly name found under the old configuration", () => {
    const devices = [
      {
        name: "desk",
        friendly_name: "Desk Lamp",
        configuration: "devices/lights/desk.yaml",
      },
    ] as ConfiguredDevice[];

    expect(
      firmwareJobDisplayName(rename("devices/lights/desk.yaml"), devices, localize)
    ).toBe("Desk Lamp (desk → lamp)");
  });

  it("finds the device under the new nested configuration once renamed", () => {
    const devices = [
      { name: "lamp", friendly_name: "", configuration: "devices/lights/lamp.yml" },
    ] as ConfiguredDevice[];

    expect(
      firmwareJobDisplayName(rename("devices/lights/desk.yml"), devices, localize)
    ).toBe("lamp (desk → lamp)");
  });

  it("drops the friendly prefix when it equals the old name", () => {
    const devices = [
      { name: "desk", friendly_name: "", configuration: "desk.yaml" },
    ] as ConfiguredDevice[];

    expect(firmwareJobDisplayName(rename("desk.yaml"), devices, localize)).toBe(
      "desk → lamp"
    );
  });
});
