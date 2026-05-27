/**
 * Compare the local dashboard's bundled ESPHome version against
 * a paired build-server's reported version and classify the
 * result for the operator-facing mismatch sub-line in Settings →
 * Build server → paired build servers.
 *
 * Versions are ESPHome's ``YYYY.M[.P][-suffix]`` shape (e.g.
 * ``2026.5.0``, ``2026.5.0b1``, ``2026.5.0-dev``). The first
 * two components (year + month) advance in lockstep with the
 * monthly ESPHome release and are what the scheduler's
 * allow-major-version-mismatch toggle keys on once 7a-3 +
 * 7b-toggle land: a YAML produced by the offloader against
 * ``2026.5`` is generally safe to compile on a receiver that
 * is also ``2026.5.*`` (patch differences are bugfix-only by
 * convention), but cross-month drift is the case the operator
 * wants to know about and explicitly accept.
 *
 * Returned shape:
 *   * ``null`` — versions match, or either side is unknown
 *     (handshake hasn't completed yet, dev build, …). Hide
 *     the sub-line.
 *   * ``"patch"`` — same year+month, patch / suffix differs.
 *     Informational; compile is almost always safe.
 *   * ``"release"`` — year+month differs. Cautionary; the
 *     YAML may reference fields the receiver's schema does
 *     not recognise (or vice versa).
 *
 * The helper returns the classification kind only; it does
 * not echo back the version strings. The caller already
 * holds both values and renders them verbatim in the
 * translated sub-line (see settings-dialog's
 * ``_renderPairingVersionMismatch``).
 */
export type VersionMismatchKind = "patch" | "release" | null;

/**
 * Returns the mismatch classification for two ESPHome version
 * strings. See module docstring for the contract.
 */
export function classifyVersionMismatch(
  local: string,
  peer: string
): VersionMismatchKind {
  // Either side unknown — handshake hasn't filled in the peer
  // value yet (PENDING / first-session) or the local probe
  // hasn't resolved. Don't surface a mismatch banner against
  // a missing baseline; the operator can't act on "unknown".
  if (!local || !peer) return null;
  if (local === peer) return null;

  // First two dot-separated components are year + month for
  // ESPHome's CalVer scheme. Modern ESPHome puts pre-release
  // suffixes on the patch component (e.g. 2026.5.0b1 -> the
  // suffix lives on "0b1") so dropping the third component
  // is enough to make 2026.5.0 and 2026.5.0b1 classify as
  // patch-level. Older / hypothetical shapes occasionally
  // put the suffix on the month component (2026.5b1) — the
  // stripSuffix() call here is the defence against those:
  // it trims trailing non-digits off the month component so
  // 2026.5b1 and 2026.5 still classify as the same release.
  const localParts = local.split(".");
  const peerParts = peer.split(".");
  const localRelease = `${localParts[0] ?? ""}.${stripSuffix(localParts[1] ?? "")}`;
  const peerRelease = `${peerParts[0] ?? ""}.${stripSuffix(peerParts[1] ?? "")}`;
  return localRelease === peerRelease ? "patch" : "release";
}

/**
 * Trim any non-digit suffix off a CalVer component so
 * ``5b1`` -> ``5``. Used by the release-level comparator so
 * ``2026.5b1`` and ``2026.5`` classify as the same release.
 */
function stripSuffix(component: string): string {
  const match = component.match(/^(\d+)/);
  return match ? match[1] : component;
}
