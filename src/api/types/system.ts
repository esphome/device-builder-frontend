/**
 * Serial ports, chip detection, user preferences, onboarding, archive.
 *
 * Part of the src/api/types.ts barrel split.
 */

// ─── Config / System ─────────────────────────────────────────

export interface SerialPort {
  port: string;
  desc: string;
}

/**
 * Result of ``config/detect_chip`` — backend ran esptool against a
 * server-side serial port and identified what's connected. Mirrors
 * what the WebSerial path returns from ``detectChip`` +
 * ``readDeviceManifest`` so the wizard can route both branches
 * the same way.
 *
 * ``chip_family`` is the human-readable family string and matches
 * one of the ``WIZARD_BOARD_PLATFORMS.label`` values — callers
 * hand it straight to ``_selectedFilter`` to narrow the board
 * picker.
 *
 * ``board_id`` comes from ``esp_app_desc_t.project_name`` (the
 * CMake project name baked in at build time). Present only when
 * the device is running an IDF app whose descriptor parses
 * cleanly; routes the wizard to a specific catalogue board.
 */
export interface DetectChipResult {
  chip_family: string;
  variant: string;
  platform: string;
  board_id?: string;
}

export enum DashboardView {
  CARDS = "cards",
  TABLE = "table",
}

export enum Theme {
  LIGHT = "light",
  DARK = "dark",
  SYSTEM = "system",
}

export enum SortDirection {
  ASC = "asc",
  DESC = "desc",
}

export interface UserPreferences {
  dashboard_view: DashboardView;
  theme: Theme;
  navigator_visible: boolean;
  expert_mode: boolean;
  table_page_size: number;
  table_column_visibility: Record<string, boolean>;
  table_sort_column: string | null;
  table_sort_direction: SortDirection | null;
  /** Highest onboarding-flow version the user has acknowledged.
   *  ``0`` ⇒ never gone through onboarding. The dashboard surfaces
   *  the wizard whenever this is below the server's
   *  ``OnboardingState.current_version``. */
  onboarding_completed_version: number;
}

/**
 * Stable identifiers for onboarding steps. Keep in lockstep with
 * the backend's ``OnboardingStepId`` enum — these strings flow
 * through the wire as-is.
 */
export enum OnboardingStepId {
  WIFI_CREDENTIALS = "wifi_credentials",
}

export enum OnboardingStepStatus {
  PENDING = "pending",
  DONE = "done",
}

export interface OnboardingStep {
  id: OnboardingStepId;
  status: OnboardingStepStatus;
}

/**
 * Snapshot of the dashboard onboarding flow.
 *
 * ``current_version`` is the version of onboarding the server
 * knows about; ``completed_version`` is what the user last
 * acknowledged. The wizard auto-pops when ALL of the following
 * are true: ``completed_version < current_version`` (user is
 * behind a newer onboarding version), at least one
 * ``steps[].status`` is ``pending`` (there's actually
 * something to do), and the user hasn't frontend-side
 * session-dismissed it. A version bump alone isn't enough —
 * pre-wizard installs all started at ``completed_version = 0``
 * and asking a user with already-configured secrets to re-enter
 * them is friction with no payoff. The exact gate lives in
 * ``src/util/onboarding-gate.ts`` (``shouldAutoShowOnboarding``)
 * with unit-test coverage of every branch.
 *
 * Manual entry via the Wi-Fi kebab item bypasses both the
 * version-bump gate and the session-dismiss flag — the click IS
 * the explicit "I want to do this now" signal. The entry is
 * ALWAYS visible so a user can rotate already-configured
 * credentials without hand-editing ``secrets.yaml``;
 * ``isOnboardingPending`` only selects its wording (``Set up
 * Wi-Fi`` when nothing is configured yet vs ``Change Wi-Fi
 * credentials`` once it is), it no longer gates visibility.
 *
 * That label is computed from live on-disk state on every
 * server-side ``get_state`` call — never persisted — and the
 * dashboard re-fetches on (re)connect AND on every
 * ``secrets-saved`` event, so an in-app save (wizard or
 * Secrets editor) updates the wording in real time and an
 * out-of-band ``secrets.yaml`` edit flips it no later than
 * the next WS reconnect.
 */
export interface OnboardingState {
  current_version: number;
  completed_version: number;
  steps: OnboardingStep[];
}

/**
 * Per-device result from any bulk WS command (``devices/delete_bulk``,
 * ``devices/archive_bulk``). Shape is ``{configuration, success, error?}``;
 * the backend's ``_run_bulk_per_device`` helper produces this for both.
 */
export interface BulkActionResult {
  configuration: string;
  success: boolean;
  error?: string;
}

/**
 * Soft-deleted device row returned by ``devices/list_archived``.
 *
 * Shape mirrors a stripped-down ``ConfiguredDevice``: just enough
 * metadata for the dashboard's archived-devices dialog (opened
 * from the header kebab) to render a row + Unarchive /
 * Delete-permanently controls. The full YAML / metadata stays on
 * disk under ``<config_dir>/archive/`` and is fetched on demand.
 */
export interface ArchivedDevice {
  configuration: string;
  name: string;
  friendly_name: string;
  comment: string | null;
}
