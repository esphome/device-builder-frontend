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
  /** YAML disabled encryption; device either confirmed plaintext or
   *  mDNS hasn't been seen. The lock-open warning indicator. */
  | "plaintext"
  /** YAML enables encryption; mDNS confirms the device is running it,
   *  or mDNS hasn't been seen and we trust the YAML. */
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
  if (!d.api_encrypted) return "plaintext";
  const observed = d.api_encryption_active;
  /* mDNS not seen yet: trust the YAML. ``observed == null`` (loose
     equality) catches both ``null`` and ``undefined`` — the latter
     can sneak in from older backends or cached WS payloads that
     predate the field. */
  if (observed == null) return "active";
  /* TXT absent → device is running plaintext API. If the user has
     unflashed changes, they probably know — surface "pending" so the
     indicator nudges toward Install. Otherwise it's a real mismatch. */
  if (observed === "") {
    return d.has_pending_changes ? "pending" : "mismatch";
  }
  /* TXT present (e.g. ``Noise_NNpsk0_25519_ChaChaPoly_SHA256``). */
  return "active";
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
export function getEncryptionVisual(
  state: EncryptionState,
): EncryptionVisual | null {
  return state === "none" ? null : VISUALS[state];
}
