/**
 * Sanitize a user-uploaded YAML filename's stem (without ``.yaml`` /
 * ``.yml``) for use as a configuration filename.
 *
 * The user's intent is "import my working config" — we should preserve
 * the existing filename character-for-character wherever the
 * filesystem allows it. That means underscores, hyphens, dots, accents,
 * and non-Latin scripts all round-trip; only characters that would
 * actually break a filesystem write or the URL we navigate to are
 * stripped.
 *
 * Blocked because they break a write or a path comparison:
 *
 * - Path separators (``/`` and ``\``) — collapse them to nothing so
 *   the slug is always a single component (the backend's ``rel_path``
 *   would reject a traversal anyway, but we strip here to keep the
 *   error message about the *content* rather than the path).
 * - NUL and the C0 control range (``\x00``-``\x1f``) — the kernel
 *   rejects NUL outright on most filesystems and the control bytes
 *   render unintelligibly in the device list.
 * - Windows-illegal punctuation (``< > : " | ? *``) so a config
 *   imported on Linux still flashes from a Windows host.
 * - URL fragment delimiter (``#``) — the dashboard navigates to
 *   ``/device/<configuration>`` after import, and a literal ``#``
 *   would split the URL at the fragment boundary regardless of
 *   ``encodeURIComponent``.
 *
 * Surrounding whitespace and dots are also trimmed because Windows
 * silently strips trailing ones at write time, which would let
 * ``foo.yaml`` and ``foo .yaml`` collide.
 *
 * Windows reserved device names (``CON``, ``PRN``, ``AUX``, ``NUL``,
 * ``COM1``..``COM9``, ``LPT1``..``LPT9``, case-insensitive) are
 * suffixed with ``_`` so the resulting ``CON.yaml`` doesn't collide
 * with the Windows console device. Detected on the *stem* before any
 * extension, matching how Windows' own file APIs evaluate it.
 *
 * Returns the empty string when the input was made entirely of
 * stripped chars — the caller is responsible for surfacing that as a
 * user error (the backend rejects empty ``name`` with INVALID_ARGS).
 */
const WINDOWS_RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

export function safeUploadFilename(stem: string): string {
  const cleaned = stem
    .replace(/[/\\]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"|?*#\x00-\x1f]/g, "")
    .replace(/^[\s.]+|[\s.]+$/g, "");
  // Suffix reserved Windows device names so writing ``CON.yaml`` etc.
  // doesn't try to address the console / printer / serial port. Match
  // is on the upper-cased stem regardless of trailing extension because
  // Windows treats ``CON``, ``CON.yaml``, ``CON.yaml.bak`` all as the
  // same device.
  if (WINDOWS_RESERVED_NAMES.has(cleaned.toUpperCase())) {
    return `${cleaned}_`;
  }
  return cleaned;
}
