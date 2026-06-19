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

/**
 * Device editor pane layout: the form, the YAML pane, or both. Keep in
 * lockstep with the backend's ``EditorLayout`` enum.
 */
export enum EditorLayout {
  /** Form / guide only, YAML pane hidden. */
  VISUAL = "visual",
  /** YAML pane only. */
  YAML = "yaml",
  /** Split: form / guide alongside the YAML pane. */
  BOTH = "both",
}

/**
 * Secrets editor layout: the form or the YAML pane, never both. A
 * dedicated enum keeps ``both`` off the wire. Keep in lockstep with the
 * backend's ``SecretsEditorLayout`` enum.
 */
export enum SecretsEditorLayout {
  VISUAL = "visual",
  YAML = "yaml",
}

/**
 * How much ESPHome the user knows — tailors UI weight. Chosen in
 * onboarding, changeable in Settings. ``null`` (a fresh install that
 * hasn't picked) is distinct from any level. Keep in lockstep with
 * the backend's ``ExperienceLevel`` enum.
 */
export enum ExperienceLevel {
  /** New to ESPHome — keep it light, expert surfaces hidden. */
  BEGINNER = "beginner",
  /** Power user — unlocks the editor diff, navigator search, YAML search. */
  EXPERT = "expert",
}

export interface UserPreferences {
  dashboard_view: DashboardView;
  theme: Theme;
  navigator_visible: boolean;
  /** Which editor panes the user keeps open, persisted so the choice
   *  survives a new browser. The secrets editor has no split view. */
  device_editor_layout: EditorLayout;
  secrets_editor_layout: SecretsEditorLayout;
  table_page_size: number;
  table_column_visibility: Record<string, boolean>;
  table_sort_column: string | null;
  table_sort_direction: SortDirection | null;
  /** Experience level chosen in onboarding (``null`` until chosen).
   *  ``EXPERT`` is the single source of truth for "expert mode". */
  experience_level: ExperienceLevel | null;
  /** This install is only a remote build node: onboarding skips the
   *  Wi-Fi step and device-creation entry points are hidden. */
  remote_compute_only: boolean;
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
  USE_CASE = "use_case",
  EXPERIENCE_LEVEL = "experience_level",
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
