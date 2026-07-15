/** Display helpers shared by every surface that renders a peer row (the
 *  settings paired-senders list and the dashboard's Build server panel). */

/** Pill class + i18n key for a peer's live connection state. */
export function peerConnectionPill(connected: boolean): {
  className: string;
  labelKey: string;
} {
  return connected
    ? {
        className: "peer-connection-pill peer-connection-connected",
        labelKey: "settings.build_server_peer_connected",
      }
    : {
        className: "peer-connection-pill peer-connection-disconnected",
        labelKey: "settings.build_server_peer_disconnected",
      };
}

/**
 * Seconds since a peer's Unix-seconds ``paired_at``, for
 * :func:`formatSecondsAgo`.
 *
 * A ``paired_at`` of 0 (legacy / corrupt) returns null so the row hides the
 * line instead of showing a misleading "55 years ago".
 */
export function pairedAgoSeconds(pairedAt: number, nowMs: number): number | null {
  return pairedAt > 0 ? Math.max(0, nowMs / 1000 - pairedAt) : null;
}
