/** True on Apple platforms, where shortcut hints use the ⌘ glyph.
 *  ``userAgentData`` first; ``navigator.platform`` is deprecated but remains
 *  the only signal on Firefox and Safari. Guarded so callers never touch an
 *  absent ``navigator``. */
export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac|iphone|ipad/i.test(
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
      navigator.platform
  );
}
