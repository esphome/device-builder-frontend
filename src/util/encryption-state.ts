import { mdiLock, mdiLockAlert, mdiLockClock, mdiLockOpenVariant } from "@mdi/js";

/** Minimal shape needed to derive the encryption state. ``ConfiguredDevice``
 *  satisfies this; the table-row and card components also pass narrowed
 *  versions of the same fields so the helper isn't tied to the full
 *  device record. */
export interface EncryptionInputs {
  api_enabled: boolean;
  api_encrypted: boolean;
  api_encryption_active: string | null;
  has_pending_changes: boolean;
}

export type EncryptionState =
  /** No native API exposed — no indicator at all. */
  | "none"
  /** Encryption is not in effect on the device. Either the YAML
   *  disabled it AND the wire didn't contradict, OR mDNS confirmed
   *  plaintext directly. The lock-open warning indicator. */
  | "plaintext"
  /** Encryption is in effect. Either mDNS reports a truthy cipher
   *  string (the running firmware is broadcasting Noise — wire
   *  authoritative), or the YAML enables encryption and the wire
   *  hasn't contradicted it (mDNS not seen yet → trust the YAML).
   *  The wire-authoritative arm catches configs whose YAML pass
   *  diverges from the running firmware (issue #437: ESPHome's
   *  Jinja-templated packages aren't run by the dashboard's
   *  ``yaml_util.load_yaml``). */
  | "active"
  /** YAML enables encryption but the device is broadcasting plaintext
   *  AND ``has_pending_changes`` is set — we know the user just edited
   *  the config and hasn't flashed yet. */
  | "pending"
  /** YAML enables encryption, the device is broadcasting plaintext,
   *  and there's no pending compile to explain it. The device is out
   *  of sync with the YAML and probably needs a fresh install. */
  | "mismatch";

/**
 * Combine the YAML-derived ``api_encrypted`` flag with the mDNS
 * ``api_encryption`` observation into the four-state indicator the
 * card / table / drawer all render.
 */
export function getEncryptionState(d: EncryptionInputs): EncryptionState {
  if (!d.api_enabled) return "none";
  const observed = d.api_encryption_active;
  /* Truth on the wire trumps the YAML signal. A truthy
     ``api_encryption_active`` (e.g.
     ``Noise_NNpsk0_25519_ChaChaPoly_SHA256``) is the running
     firmware reporting "encryption is on right now" — a YAML
     edit elsewhere (whitespace, comment, sensor tweak) doesn't
     disable that, so the indicator stays green even when
     ``has_pending_changes`` is set.

     Checked BEFORE the ``!api_encrypted`` short-circuit on
     purpose: dashboard issue #437 surfaces a config where
     encryption is configured via ESPHome's Jinja-templated
     packages (``api: |\\n  # set ns = ... ${ns.cfg}``), which
     the dashboard's ``yaml_util.load_yaml`` doesn't render. The
     YAML pass therefore comes back as ``api_encrypted=false``,
     but the device's mDNS broadcast carries the live cipher
     string. Honouring the wire here keeps the indicator
     correct for any future ESPHome preprocessor feature the
     dashboard doesn't reproduce, not just this one Jinja
     case. */
  if (observed) return "active";
  if (!d.api_encrypted) return "plaintext";
  /* From here ``observed`` is either ``""`` (mDNS seen, TXT
     absent — device is plaintext) or ``null`` / ``undefined``
     (mDNS not seen yet). In both cases the running firmware is
     not confirmed-encrypted, so a pending-changes flag is the
     "Take Control just added encryption to the YAML, but the
     vendor image on the device hasn't been replaced yet" path —
     show "pending" to nudge the user toward Install. */
  if (d.has_pending_changes) return "pending";
  /* No pending changes:
       - ``observed == null`` → mDNS hasn't reported. Trust the
         YAML; the device is presumed encrypted until proven
         otherwise. ``observed == null`` (loose equality) covers
         ``null`` and ``undefined`` — the latter can sneak in
         from older backends or cached WS payloads that predate
         the field.
       - ``observed === ""`` → mDNS confirmed plaintext. The
         firmware on the device disagrees with the YAML and there
         is no pending compile to explain it: real mismatch,
         probably a failed flash or a device flashed elsewhere. */
  return observed == null ? "active" : "mismatch";
}

export interface EncryptionVisual {
  iconName: string;
  iconPath: string;
  /** CSS class on the lock icon — controls the colour treatment.
   *  Maps to the ``.encryption-icon.<class>`` rules already in the
   *  card / table styles. */
  cssClass: "secure" | "insecure" | "pending" | "mismatch";
  /** Localize key for the title / aria-label. */
  tooltipKey: string;
}

const VISUALS: Record<Exclude<EncryptionState, "none">, EncryptionVisual> = {
  active: {
    iconName: "lock",
    iconPath: mdiLock,
    cssClass: "secure",
    tooltipKey: "dashboard.table_status_encrypted_tooltip",
  },
  plaintext: {
    iconName: "lock-open-variant",
    iconPath: mdiLockOpenVariant,
    cssClass: "insecure",
    tooltipKey: "dashboard.table_status_unencrypted_tooltip",
  },
  pending: {
    iconName: "lock-clock",
    iconPath: mdiLockClock,
    cssClass: "pending",
    tooltipKey: "dashboard.table_status_encryption_pending_tooltip",
  },
  mismatch: {
    iconName: "lock-alert",
    iconPath: mdiLockAlert,
    cssClass: "mismatch",
    tooltipKey: "dashboard.table_status_encryption_mismatch_tooltip",
  },
};

/** Returns ``null`` for the ``"none"`` state so callers can skip rendering. */
export function getEncryptionVisual(state: EncryptionState): EncryptionVisual | null {
  return state === "none" ? null : VISUALS[state];
}

/**
 * Compact-view variant of :func:`getEncryptionVisual` for the
 * dashboard table rows and device cards. Returns ``null`` for the
 * confirmed-encrypted-by-mDNS case (truthy ``api_encryption_active``
 * combined with ``"active"`` state) — that's the steady state on
 * a healthy fleet, and repeating a green lock on every row / card
 * drowns out the rows / cards that need attention. The
 * unconfirmed-but-YAML-says-encrypted case (``api_encryption_active``
 * null/undefined) keeps its icon so "waiting / unknown" stays
 * visible. Use the full :func:`getEncryptionVisual` in
 * single-device contexts (drawer / details pane) where confirmation
 * is useful. (issue #141)
 */
export function getCompactEncryptionVisual(d: EncryptionInputs): EncryptionVisual | null {
  const state = getEncryptionState(d);
  if (state === "active" && d.api_encryption_active) return null;
  return getEncryptionVisual(state);
}
