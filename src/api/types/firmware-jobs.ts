/**
 * Firmware build/upload jobs and their artifacts.
 *
 * Part of the src/api/types.ts barrel split.
 */

// ─── Firmware Jobs ──────────────────────────────────────────

export enum JobStatus {
  QUEUED = "queued",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

export enum JobType {
  COMPILE = "compile",
  UPLOAD = "upload",
  INSTALL = "install",
  CLEAN = "clean",
  RESET_BUILD_ENV = "reset_build_env",
  RENAME = "rename",
}

/** Output stream discriminator on a single line of build output. */
export enum JobStream {
  STDOUT = "stdout",
  STDERR = "stderr",
}

/** Subset of {@link JobType} the remote-build submit_job WS arg accepts. */
export type RemoteBuildSubmitTarget = JobType.COMPILE | JobType.UPLOAD;

/** Where the bytes for a firmware build come from.
 *
 *  Mirrors the backend's ``JobSource`` StrEnum (7a-2a). ``LOCAL`` is
 *  a build this dashboard's CPU ran; ``REMOTE`` is a build a paired
 *  receiver ran and the offloader fetched the artifacts from. The
 *  install dialog reads ``FirmwareJob.source_label`` to render a
 *  "Building on {receiver_label}" sub-line when ``source ===
 *  REMOTE``. ``REMOTE_PENDING`` is the transient before dispatch: a
 *  compile that will run on a paired server, but whose server is
 *  chosen when one frees, so ``source_label`` is still empty. */
export enum JobSource {
  LOCAL = "local",
  REMOTE = "remote",
  REMOTE_PENDING = "remote_pending",
}

export interface FirmwareJob {
  job_id: string;
  configuration: string;
  job_type: JobType;
  status: JobStatus;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  /** Compile-phase bounds (CMake configure counts, the download doesn't),
   *  stamped by the
   *  backend so the compile timer stays correct across a reload / reconnect.
   *  Null before the compile phase begins / finishes; absent entirely on jobs
   *  from a backend that predates them, so callers must degrade gracefully. */
  compile_started_at?: string | null;
  compile_ended_at?: string | null;
  exit_code: number | null;
  output: string[];
  error: string | null;
  port: string;
  /** Set on an UPLOAD that flashes the bootloader image instead of the
   *  app (`esphome upload --bootloader`); OTA targets only. */
  flash_bootloader?: boolean;
  /** New device name. Carried only by ``rename`` jobs; the backend
   *  dataclass defaults to ``""`` for every other job type so the
   *  field is always present on the wire — required here matches. */
  new_name: string;
  /** Prerequisite job id, or ``""``. An install's UPLOAD carries its
   *  COMPILE's ``job_id`` (held until the compile succeeds). */
  depends_on: string;
  /** Set on an install COMPILE for an offline device: no dependent
   *  UPLOAD exists; the backend flashes when the device reconnects. */
  is_deferred_install?: boolean;
  /** 0–100 progress, monotonically non-decreasing while the job runs.
   *  `null` until the underlying tooling (PlatformIO/esptool) emits a
   *  percentage we can latch onto. */
  progress: number | null;
  /** Where the build's bytes come from (7a-2a). Defaults to LOCAL
   *  for jobs from before this field landed; jobs the install
   *  handler routed to a paired receiver via ``pick_build_path``
   *  (7a-3) carry ``REMOTE``. */
  source: JobSource;
  /** Machine-readable handle on the receiver that compiled the job
   *  when ``source === REMOTE`` — matches the StoredPairing's
   *  ``pin_sha256``. Empty string for LOCAL jobs. The runner uses
   *  this to route ``cancel_job`` / ``download_artifacts`` against
   *  the right peer-link client. */
  source_pin_sha256: string;
  /** Display label for the paired receiver that compiled the job,
   *  when ``source === REMOTE``. Empty string for LOCAL jobs.
   *  Snapshot of the pairing's label at job-creation time — doesn't
   *  track later renames (the install dialog should show what the
   *  user saw when they clicked Install). */
  source_label: string;
  /** Receiver's bundled ``esphome`` version at job-creation time,
   *  snapshotted from the pairing's last-known
   *  ``esphome_version``. Empty for LOCAL jobs and for REMOTE jobs
   *  whose pairing hadn't yet completed a peer-link session. The
   *  install dialog renders this next to ``source_label`` so the
   *  operator can spot a version skew between the offloader and
   *  the receiver actually compiling the firmware. */
  source_esphome_version: string;
  /** Offloader's ``dashboard_id`` when this job came in via the
   *  peer-link ``submit_job`` flow. Empty for locally-submitted
   *  jobs. Receiver-side rendering surfaces this as a "from
   *  <peer>" sub-line on the firmware-tasks dialog so a
   *  build-server admin can distinguish their own work from
   *  delegated builds. */
  remote_peer: string;
  /** Display label for the offloader, snapshotted from the
   *  receiver's ``_approved_peers[dashboard_id].label`` at submit
   *  time. Empty for locally-submitted jobs and for jobs from
   *  before this field landed; the receiver-side renderer falls
   *  back to the raw ``remote_peer`` dashboard_id when empty.
   *  Symmetric to ``source_label`` on the offloader side. */
  remote_peer_label: string;
  /** The submitting device's ``esphome.name`` (machine handle),
   *  sent by the offloader on the ``submit_job`` header. Empty
   *  for locally-submitted jobs and for jobs whose offloader
   *  didn't set the NotRequired wire field. The receiver-side
   *  title surface uses this when ``remote_peer !== ""`` since
   *  the receiver has no Device list of its own to look the
   *  friendly name up against. */
  device_name: string;
  /** The submitting device's ``esphome.friendly_name`` (display
   *  string), sent by the offloader on the ``submit_job`` header.
   *  Empty for locally-submitted jobs, for jobs whose offloader
   *  didn't set the NotRequired wire field, or for YAMLs that
   *  don't define ``esphome.friendly_name``. The receiver-side
   *  title surface prefers this over ``device_name`` when set. */
  device_friendly_name: string;
}

/** Terminal frame of a ``firmware/follow_job`` stream. */
export interface FirmwareJobResult {
  status: JobStatus;
  exit_code: number | null;
  /** Human-readable failure reason; null for successful jobs. */
  error: string | null;
  /** True only when the finished job armed a queued update (the device
   *  flashes on its next wake) — unlike the job row's raw
   *  ``is_deferred_install``, a failed deferred compile reports false. */
  queued_update_armed: boolean;
}

export interface FirmwareBinary {
  title: string;
  file: string;
  // Optional subtext from ESPHome's get_download_types; not every platform supplies one.
  description?: string;
  // Stable artifact tag (``factory`` / ``ota`` / ``elf`` / ``bin`` / ``uf2``)
  // the UI maps to a localized label, falling back to ``title`` when absent.
  type?: string;
}
