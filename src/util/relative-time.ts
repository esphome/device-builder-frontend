/**
 * Format a "seconds ago" duration as a human-readable, localized string.
 *
 * Wraps :class:`Intl.RelativeTimeFormat` so the result respects the
 * browser's locale without us shipping per-language strings — the
 * Home Assistant frontend's ``relativeTime`` helper does the same
 * thing (``frontend/src/common/datetime/relative_time.ts``). With
 * ``numeric: "auto"`` the formatter renders "now" / "1 second ago"
 * / "2 minutes ago" idiomatically per locale; we just have to pick
 * the right unit + sign.
 *
 * Used by the device drawer's Reachability section to render the
 * per-signal "last seen" line. The drawer ticks at 1Hz so
 * the displayed string reads fresh without round-tripping the
 * backend; this formatter is a pure function so each tick is just
 * a recompute against ``Date.now()``.
 *
 * Buckets:
 *   - ``< 60s``    → seconds (negative → "X seconds ago")
 *   - ``< 60 min`` → minutes (rounded down)
 *   - ``< 24 h``   → hours (rounded down)
 *   - ``≥ 24 h``   → days (rounded down)
 *
 * ``null`` / ``undefined`` input → empty string. Callers gate the
 * row on the source value, so a ``null`` here only happens when
 * the row was mistakenly rendered without data — empty string is
 * less misleading than "now".
 */
const formatterCache = new Map<string, Intl.RelativeTimeFormat>();

function getFormatter(language?: string): Intl.RelativeTimeFormat {
  const lang = language ?? "default";
  let formatter = formatterCache.get(lang);
  if (formatter === undefined) {
    formatter = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
    formatterCache.set(lang, formatter);
  }
  return formatter;
}

export function formatSecondsAgo(
  secondsAgo: number | null | undefined,
  language?: string
): string {
  if (secondsAgo === null || secondsAgo === undefined) return "";

  const seconds = Math.max(0, Math.floor(secondsAgo));
  const formatter = getFormatter(language);

  // ``Intl.RelativeTimeFormat`` takes a *signed* magnitude — negative
  // = past — and a unit. Pick the largest unit whose magnitude is at
  // least one whole step so "47 seconds ago" doesn't render as "0
  // minutes ago" when seconds round-down to zero.
  if (seconds < 60) {
    return formatter.format(-seconds, "second");
  }
  if (seconds < 3600) {
    return formatter.format(-Math.floor(seconds / 60), "minute");
  }
  if (seconds < 86400) {
    return formatter.format(-Math.floor(seconds / 3600), "hour");
  }
  return formatter.format(-Math.floor(seconds / 86400), "day");
}

/**
 * Add the elapsed wall-clock since *anchor* (in ms) onto a backend-
 * supplied ``seconds_ago`` baseline.
 *
 * The backend stamps ``*_last_seen_seconds_ago`` against
 * ``time.monotonic()`` at the moment it sends the event. By the
 * time the drawer ticks 30 seconds later, the displayed string
 * should read 30s newer. This helper bridges those two clocks
 * without trusting them to be in sync — the frontend captures
 * ``Date.now()`` when the snapshot arrived (the *anchor*) and
 * adds ``(now - anchor) / 1000`` to the snapshot's value before
 * formatting.
 *
 * ``null`` baseline propagates as ``null`` so the row can be hidden.
 */
export function ageOf(
  baselineSecondsAgo: number | null | undefined,
  anchorMs: number,
  nowMs: number
): number | null {
  if (baselineSecondsAgo === null || baselineSecondsAgo === undefined) {
    return null;
  }
  const elapsedSeconds = Math.max(0, (nowMs - anchorMs) / 1000);
  return baselineSecondsAgo + elapsedSeconds;
}

/**
 * Subtract the elapsed wall-clock since *anchor* (in ms) from a
 * backend-supplied ``expires_in_seconds`` baseline.
 *
 * Mirror of :func:`ageOf` for forward-looking countdowns: where
 * ``ageOf`` advances a "seconds ago" baseline, ``remainingOf``
 * winds a "seconds left" baseline down. The pairing-window
 * countdown in Settings → Pairing requests uses this so the
 * displayed M:SS reads fresh between
 * ``remote_build_pairing_window_changed`` events without
 * trusting frontend / backend clocks to be in sync.
 *
 * Clamps at zero rather than going negative; a UI counting
 * down to a deadline doesn't have a meaningful negative reading
 * and the next server event re-seeds the baseline anyway. The
 * return value is fractional seconds (no rounding); callers
 * that want whole-second display ticks (the M:SS chip in
 * Settings → Pairing requests, for example) ``Math.floor`` at
 * the format step.
 *
 * ``null`` baseline propagates as ``null`` so the row can be
 * hidden.
 */
export function remainingOf(
  baselineRemainingSeconds: number | null | undefined,
  anchorMs: number,
  nowMs: number
): number | null {
  if (baselineRemainingSeconds === null || baselineRemainingSeconds === undefined) {
    return null;
  }
  const elapsedSeconds = Math.max(0, (nowMs - anchorMs) / 1000);
  return Math.max(0, baselineRemainingSeconds - elapsedSeconds);
}

/**
 * Memoized ``Intl.NumberFormat`` per (locale, fraction-digits) key.
 *
 * Both the drawer's RTT row ("4.2 ms", 1 fraction digit) and TTL
 * row ("38s", 0 fraction digits) need a locale-aware number
 * formatter. Constructing one in the row renderer means a fresh
 * allocation per row per render — the drawer ticks at 1Hz and
 * has up to three Reachability rows visible, so that's 3
 * allocations/sec for what should be a stable lookup.
 *
 * Mirrors the ``RelativeTimeFormat`` cache above, just keyed on
 * the joint of language + ``maximumFractionDigits`` so the two
 * call sites don't share each other's precision.
 */
const numberFormatterCache = new Map<string, Intl.NumberFormat>();

export function getNumberFormatter(
  language: string | undefined,
  maximumFractionDigits: number
): Intl.NumberFormat {
  const key = `${language ?? "default"}|${maximumFractionDigits}`;
  let formatter = numberFormatterCache.get(key);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(language, { maximumFractionDigits });
    numberFormatterCache.set(key, formatter);
  }
  return formatter;
}
