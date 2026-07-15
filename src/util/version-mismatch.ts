import type { PairingSummary, PeerStatus } from "../api/types/remote-build.js";

/**
 * Compare the local dashboard's bundled ESPHome version against
 * a paired build-server's reported version and classify the
 * result for the operator-facing mismatch sub-line in Settings →
 * Build server → paired build servers, and for the per-policy
 * filter under ``VersionMatchPolicy.RELEASE`` (year + month
 * match) and ``EXACT`` (full match).
 *
 * Versions are ESPHome's ``YYYY.M[.P][-suffix]`` shape (e.g.
 * ``2026.5.0``, ``2026.5.0b1``, ``2026.5.0-dev``); year + month
 * advance in lockstep with the monthly ESPHome release.
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
 */
export type VersionMismatchKind = "patch" | "release" | null;

/**
 * Whether *version* pins to a reproducible `pip install esphome==<v>` —
 * a plain release or an a/b/rc pre-release, the shapes PyPI publishes.
 * Twin of the backend's `is_pinnable_version`; the auto-provision copy
 * only applies when the receiver could actually provision our version.
 */
export function isPinnableVersion(version: string): boolean {
  return /^\d+(?:\.\d+)*(?:(?:a|b|rc)\d+)?$/.test(version);
}

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

/**
 * Why a backend `NO_COMPATIBLE_PEER` install error fired.
 *
 *   * ``offline`` — every operator-intentional pairing is currently
 *     not connected to its peer-link; the toast should suggest
 *     waiting for the build server to reconnect.
 *   * ``version`` — every operator-intentional pairing is connected
 *     but on a version that doesn't satisfy the policy; the toast
 *     should suggest matching versions or relaxing the policy.
 *   * ``mixed`` — both reasons present (or one each across
 *     multiple peers); the generic toast applies.
 */
export type NoCompatiblePeerReason = "offline" | "version" | "mixed";

/**
 * Walk the pairings to attribute a ``NO_COMPATIBLE_PEER`` failure
 * to one of the actionable buckets above.
 *
 * Only APPROVED + enabled rows count — PENDING and disabled
 * rows aren't operator-intentional, so the backend's hard-fail
 * doesn't fire on them. If there are no intentional pairings,
 * the policy itself can't be the failure cause; return
 * ``"mixed"`` so the caller falls through to the generic toast.
 * Same fallback when ``offloaderVersion`` is empty — without a
 * local baseline ``classifyVersionMismatch`` short-circuits to
 * ``null``, which would misattribute the bucket and leak an
 * empty ``{local}`` placeholder into the toast string.
 */
export function classifyNoCompatiblePeerReason(
  pairings: Iterable<PairingSummary>,
  offloaderVersion: string
): NoCompatiblePeerReason {
  if (!offloaderVersion) return "mixed";
  let offline = 0;
  let version = 0;
  for (const p of pairings) {
    if ((p.status as PeerStatus) !== "approved" || !p.enabled) continue;
    if (!p.connected) {
      offline += 1;
      continue;
    }
    if (classifyVersionMismatch(offloaderVersion, p.esphome_version) !== null) {
      version += 1;
    }
  }
  if (offline > 0 && version === 0) return "offline";
  if (version > 0 && offline === 0) return "version";
  return "mixed";
}
