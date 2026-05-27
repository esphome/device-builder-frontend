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
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const absSec = Math.abs(diffSec);
  if (absSec < 60) return rtf.format(diffSec, "second");
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
  const diffHour = Math.round(diffMin / 60);
  if (Math.abs(diffHour) < 24) return rtf.format(diffHour, "hour");
  const diffDay = Math.round(diffHour / 24);
  return rtf.format(diffDay, "day");
}

/**
 * Render an ISO timestamp as a compact absolute time. Same-day stamps
 * drop the date so they stay short; older stamps prefix a short
 * month/day.
 */
export function formatAbsoluteTime(iso: string, now: number, locale?: string): string {
  const date = new Date(iso);
  const today = new Date(now);
  const isSameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  const time = date.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (isSameDay) return time;
  const dateStr = date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
  });
  return `${dateStr} ${time}`;
}
