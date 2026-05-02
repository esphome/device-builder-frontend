import { JobType } from "../api/types.js";
import type { ConfiguredDevice, FirmwareJob } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";

/**
 * Resolve the human-readable label for a firmware job.
 *
 * Used by both the firmware-tasks dialog and the command dialog's
 * queued overlay so the same job is named the same way everywhere
 * (e.g. switching from ``configuration`` to ``friendly_name`` won't
 * accidentally drift between surfaces).
 *
 * - ``RESET_BUILD_ENV`` jobs (and any job without a ``configuration``)
 *   render as the localized "build environment" label.
 * - Otherwise prefer the configured device's friendly name → fall
 *   back to ``name`` → fall back to the raw configuration filename.
 */
export function firmwareJobDisplayName(
  job: FirmwareJob,
  devices: ConfiguredDevice[],
  localize: LocalizeFunc,
): string {
  if (job.job_type === JobType.RESET_BUILD_ENV || !job.configuration) {
    return localize("firmware_jobs.build_env_label");
  }
  const device = devices.find((d) => d.configuration === job.configuration);
  return device?.friendly_name || device?.name || job.configuration;
}
