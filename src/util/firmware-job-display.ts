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
 * - ``RENAME`` jobs surface the technical transition (``old → new``)
 *   so reopening one from the firmware-tasks list still says *which*
 *   rename this stream belongs to. Friendly name is prepended in
 *   parentheses when it differs from the raw hostname.
 * - **Receiver-side remote-build jobs** (``remote_peer !== ""``) —
 *   the receiver has no Device list to look the friendly name up
 *   against (the YAML lives at
 *   ``.esphome/.remote_builds/<id>/<device>/<device>.yaml``, useless
 *   as a title), so prefer the offloader-sent
 *   ``device_friendly_name`` → fall back to ``device_name`` → fall
 *   back to the configuration path's device segment. The
 *   ``from {peer}`` attribution lives in a separate sub-line
 *   (rendered alongside the meta row, not folded into the title)
 *   so the title stays consistent with offloader-side rendering.
 * - Otherwise prefer the configured device's friendly name → fall
 *   back to ``name`` → fall back to the raw configuration filename.
 */
export function firmwareJobDisplayName(
  job: FirmwareJob,
  devices: ConfiguredDevice[],
  localize: LocalizeFunc
): string {
  if (job.job_type === JobType.RESET_BUILD_ENV || !job.configuration) {
    return localize("firmware_jobs.build_env_label");
  }
  if (job.remote_peer) {
    if (job.device_friendly_name) {
      return job.device_friendly_name;
    }
    if (job.device_name) {
      return job.device_name;
    }
    /* Configuration is ``.esphome/.remote_builds/<id>/<device>/<device>.yaml``.
       The second-to-last segment is the device folder name — the
       cleanest fallback when both display fields are empty (older
       offloader didn't set the NotRequired wire fields). Strip
       the YAML extension off the last segment if the path has
       only the filename (defensive). */
    const segments = job.configuration.split("/");
    if (segments.length >= 2) {
      return segments[segments.length - 2];
    }
    return job.configuration.replace(/\.ya?ml$/, "") || job.configuration;
  }
  if (job.job_type === JobType.RENAME && job.new_name) {
    /* job.configuration is the *old* YAML filename (``foo.yaml`` or
       ``foo.yml``); strip the extension to recover the old device
       name for the transition label, and reuse the same extension
       for the new YAML so devices using ``.yml`` keep matching. */
    const oldExtMatch = job.configuration.match(/\.ya?ml$/);
    const ext = oldExtMatch ? oldExtMatch[0] : ".yaml";
    const oldName = job.configuration.slice(0, job.configuration.length - ext.length);
    const newConfiguration = `${job.new_name}${ext}`;
    /* Look the configured device up under either side of the rename.
       Mid-flight both YAMLs can briefly exist (the new one written
       before the old one's deleted); after the job lands only the
       new YAML survives. Either lookup gives us the friendly name. */
    const device =
      devices.find((d) => d.configuration === job.configuration) ??
      devices.find((d) => d.configuration === newConfiguration);
    const friendly = device?.friendly_name || device?.name;
    return friendly && friendly !== oldName
      ? `${friendly} (${oldName} → ${job.new_name})`
      : `${oldName} → ${job.new_name}`;
  }
  const device = devices.find((d) => d.configuration === job.configuration);
  return device?.friendly_name || device?.name || job.configuration;
}
