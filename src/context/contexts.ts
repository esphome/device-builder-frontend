/**
 * Lit Context definitions for passing data through the component tree.
 *
 * Uses @lit/context to provide reactive context values
 * without prop-drilling through intermediate components.
 */
import { createContext } from "@lit/context";
import { ESPHomeAPI } from "../api/index.js";
import type {
  AdoptableDevice,
  ConfiguredDevice,
  FirmwareJob,
  Label,
  PairingWindowState,
  PeerSummary,
} from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";

/** Context for the ESPHome API client instance. */
export const apiContext = createContext<ESPHomeAPI>(Symbol("esphome-api"));

/** Context for the list of configured devices. */
export const devicesContext = createContext<ConfiguredDevice[]>(
  Symbol("esphome-devices")
);

/** Context for the list of importable/adoptable devices. */
export const importableDevicesContext = createContext<AdoptableDevice[]>(
  Symbol("esphome-importable-devices")
);

/** Context for the ESPHome version string. */
export const versionContext = createContext<string>(Symbol("esphome-version"));

/** Context for the Device Builder server version string. */
export const serverVersionContext = createContext<string>(Symbol("esphome-server-version"));

/** Context for dark mode state. */
export const darkModeContext = createContext<boolean>(Symbol("esphome-dark-mode"));

/** Context for the localize function. */
export const localizeContext = createContext<LocalizeFunc>(
  Symbol("esphome-localize")
);

/** Context for whether the initial device list has been loaded. */
export const devicesLoadedContext = createContext<boolean>(
  Symbol("esphome-devices-loaded")
);

/** Context for whether the frontend is running inside HA ingress. */
export const isHaIngressContext = createContext<boolean>(
  Symbol("esphome-is-ha-ingress")
);

/** Context for active firmware jobs, keyed by device configuration.
 *  Tracks the latest non-terminal job per device (used for the busy
 *  spinner on cards/tables). For the full multi-job view, see
 *  `firmwareJobsContext`. */
export const activeJobsContext = createContext<Map<string, FirmwareJob>>(
  Symbol("esphome-active-jobs")
);

/** Context for jobs that just finished, keyed by device configuration.
 *  Holds the terminal job for ~30s after `_terminateJob` so the
 *  cards/tables can show a transient success/failure indicator before
 *  reverting to the regular online/offline state. */
export const recentJobsContext = createContext<Map<string, FirmwareJob>>(
  Symbol("esphome-recent-jobs")
);

/** Context for every firmware job the backend currently exposes
 *  (active and the trimmed terminal history), keyed by `job_id`.
 *  Powers the firmware-tasks dialog — a device can have several jobs
 *  in flight (e.g. compile + clean queued back-to-back), so we key
 *  by job_id to keep them all distinct. */
export const firmwareJobsContext = createContext<Map<string, FirmwareJob>>(
  Symbol("esphome-firmware-jobs")
);

/** Context for whether the YAML diff button is enabled in the editor. */
export const yamlDiffButtonContext = createContext<boolean>(
  Symbol("esphome-yaml-diff-button")
);

/**
 * Context for the receiver-side remote-build master switch.
 *
 * Phase 2 of the remote-build feature (issue #106). Off by
 * default; the value comes from the backend on startup via
 * ``remote_build/get_settings`` and is updated when the user
 * flips the toggle in Settings → Remote builder. Phase 3+ adds
 * the rest of the receiver-side knobs (cert fingerprint, tokens,
 * artifact-retention TTL, etc.) — this single boolean is the
 * scaffolding the Settings UI plugs the rest into.
 */
export const remoteBuildEnabledContext = createContext<boolean>(
  Symbol("esphome-remote-build-enabled")
);

/** Context for the integration → esphome.io docs URL map. Populated
 *  once on app load via ``components/get_integration_docs``; the
 *  drawer's loaded-integration tags consult it to decide whether to
 *  render each name as a link or plain text. */
export const integrationDocsContext = createContext<Record<string, string>>(
  Symbol("esphome-integration-docs")
);

/** Context for the global label catalog. Loaded once via
 *  ``labels/list`` on (re)connect and kept in sync via the
 *  ``label_created`` / ``label_updated`` / ``label_deleted`` push
 *  events. Per-device assignments live on each
 *  ``ConfiguredDevice.labels`` (an array of ids); consumers join
 *  against this map at render time to resolve name + color. */
export const labelsContext = createContext<Label[]>(
  Symbol("esphome-labels")
);

/**
 * Context for whether onboarding still has work to do.
 *
 * App shell loads ``onboarding/get_state`` on (re)connect and
 * after every ``secrets-saved`` event, providing ``true`` when
 * any step is data-derived ``pending`` (currently only the
 * Wi-Fi step). Header-actions consumes it to gate a dedicated
 * ``Set up Wi-Fi…`` kebab entry — the persistent re-entry path
 * for a user who declined the wizard with "I don't use Wi-Fi"
 * but might later change their mind, or who hand-cleared
 * ``wifi_ssid`` in the secrets editor.
 */
export const onboardingPendingContext = createContext<boolean>(
  Symbol("esphome-onboarding-pending")
);

/**
 * Counter that increments every time the receiver fires a
 * ``remote_build_identity_rotated`` event. Phase 3c2d (#106).
 *
 * The Build server settings card consumes this and re-fetches
 * its identity (``getRemoteBuildIdentity``) when the value
 * changes, so a rotation triggered in another tab (or via the
 * server's REST surface, eventually) refreshes the visible cert
 * fingerprint here without a manual reload. A counter rather
 * than the event payload because the IdentityView model carries
 * fields the event payload doesn't (``listener_bound``,
 * versions); a re-fetch is the simplest way to pick those up.
 */
export const buildServerIdentityRotationCounterContext = createContext<number>(
  Symbol("esphome-build-server-identity-rotation-counter")
);

/**
 * Receiver-side peer list (PENDING + APPROVED), seeded from
 * ``subscribe_events``'s ``initial_state.peers`` snapshot at
 * subscribe time and mutated locally as events arrive
 * (``remote_build_pair_request_received`` upserts;
 * ``remote_build_pair_status_changed`` flips a row's status to
 * approved or drops it on removed). Phase 4b-2 (#106).
 *
 * ``null`` until the initial-state snapshot lands so the
 * Settings UI can distinguish "no controller" / "still
 * loading" from "loaded with zero rows". The Settings dialog's
 * Pairing requests subsection consumes this directly — no
 * separate refetch path.
 */
export const buildServerPeersContext = createContext<PeerSummary[] | null>(
  Symbol("esphome-build-server-peers")
);

/**
 * Latest receiver-side pairing-window state, sourced from
 * ``remote_build_pairing_window_changed`` events. Phase 4b-2
 * (#106).
 *
 * ``null`` until the first event lands (or until the Settings
 * dialog's Build server section runs its initial
 * ``setRemoteBuildPairingWindow`` call); thereafter mirrors the
 * receiver's view: ``open: true`` while at least one client is
 * extending, ``open: false`` once everyone backs off and the
 * idle timer expires. Settings UI renders an "open / closed"
 * pill from this; the payload also carries
 * ``expires_in_seconds``, but the UI doesn't yet surface a
 * countdown — that's a follow-up. The frontend uses this
 * context for read-only display; mutations (open / close /
 * extend) go through the WS command directly so the wire
 * acknowledgement is round-tripped before the local state
 * updates.
 */
export const buildServerPairingWindowStateContext =
  createContext<PairingWindowState | null>(
    Symbol("esphome-build-server-pairing-window-state")
  );
