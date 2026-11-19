import { formatDuration } from "./relative-time.js";

// Building an Intl formatter costs far more than calling one, and the jobs
// list formats every row on every render, so reuse one per locale.
const formatterCache = new Map<string, Intl.DateTimeFormat | Intl.RelativeTimeFormat>();

function cached<T extends Intl.DateTimeFormat | Intl.RelativeTimeFormat>(
  kind: string,
  locale: string | undefined,
  make: () => T
): T {
  const key = `${kind}|${locale ?? ""}`;
  let fmt = formatterCache.get(key);
  if (!fmt) {
    fmt = make();
    formatterCache.set(key, fmt);
  }
  return fmt as T;
}

/**
 * Render an ISO timestamp as a short relative phrase ("2m ago",
 * "in 30s") via Intl.RelativeTimeFormat. Picks the coarsest unit that
 * keeps the magnitude readable — seconds → minutes → hours → days.
 * `now` is passed in so callers can drive re-renders from a ticker
 * and tests are deterministic.
 */
export function formatRelativeTime(iso: string, now: number, locale?: string): string {
  const past = new Date(iso).getTime();
  const diffSec = Math.round((past - now) / 1000);
  const rtf = cached(
    "rtf",
    locale,
    () => new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
  );
  const absSec = Math.abs(diffSec);
  if (absSec < 60) return rtf.format(diffSec, "second");
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
  const diffHour = Math.round(diffMin / 60);
  if (Math.abs(diffHour) < 24) return rtf.format(diffHour, "hour");
  const diffDay = Math.round(diffHour / 24);
  return rtf.format(diffDay, "day");
}

/** Parse an ISO timestamp to epoch ms, or null for a nullish/unparseable value. */
export function parseIsoMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * :func:`formatDuration`'s counter variant for a running millisecond
 * clock — ``45s``, ``4m 32s``, ``1h 05m``. Negative deltas clamp to ``0s``
 * so a clock skew never prints a leading minus.
 */
export function formatElapsed(ms: number, language?: string): string {
  return formatDuration(ms / 1000, { variant: "counter", language });
}

/**
 * Render an ISO timestamp as a compact absolute time. Same-day stamps
 * drop the date so they stay short; older stamps prefix a short
 * month/day.
 */
export function formatAbsoluteTime(iso: string, now: number, locale?: string): string {
  const date = new Date(iso);
  // Intl.DateTimeFormat.format throws on an invalid date, where toLocale*String returned "Invalid Date".
  if (Number.isNaN(date.getTime())) return "Invalid Date";
  const today = new Date(now);
  const isSameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  const time = cached(
    "time",
    locale,
    () => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" })
  ).format(date);
  if (isSameDay) return time;
  const dateStr = cached(
    "date",
    locale,
    () => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" })
  ).format(date);
  return `${dateStr} ${time}`;
}
