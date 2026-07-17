import type { ConfiguredDevice } from "../api/types/devices.js";
import type { FirmwareJob } from "../api/types/firmware-jobs.js";
import { JobType } from "../api/types/firmware-jobs.js";
import type { LocalizeFunc } from "../common/localize.js";

/**
 * Resolve the human-readable label for a job's *type* (as opposed to
 * ``firmwareJobDisplayName``, which names the job itself).
 *
 * A deferred install's underlying job is a plain COMPILE — the device
 * is offline, so nothing installs yet — but "Compile" alone loses the
 * context that an install is queued behind it. This surfaces it as
 * "Offline compile" instead of letting it read as an outright Install.
 *
 * COMPILE-gated: a failed OTA upload the backend converts offline also
 * carries ``is_deferred_install``, but what ran there was a flash of a
 * finished build — it keeps its honest Upload label.
 */
export function firmwareJobTypeLabel(job: FirmwareJob, localize: LocalizeFunc): string {
  if (job.is_deferred_install && job.job_type === JobType.COMPILE) {
    return localize("firmware_jobs.type_offline_compile");
  }
  return localize(`firmware_jobs.type_${job.job_type}`);
}

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

/**
 * Re-attach *dialog* to the configuration's running job, if any.
 *
 * Returns true when an active job existed (the dialog now follows it) —
 * the install seams bail on true, since enqueuing instead would
 * supersede: the backend cancels and restarts the configuration's
 * in-flight jobs ("one active job per device").
 */
export function followActiveJob(
  activeJobs: Map<string, FirmwareJob>,
  configuration: string,
  dialog: { followJob(job: FirmwareJob, displayName: string): void },
  devices: ConfiguredDevice[],
  localize: LocalizeFunc
): boolean {
  const job = activeJobs.get(configuration);
  if (!job) return false;
  dialog.followJob(job, firmwareJobDisplayName(job, devices, localize));
  return true;
}
