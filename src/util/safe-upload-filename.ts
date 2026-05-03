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
 * - URL fragment delimiter (``#``). Stripping defends against any
 *   navigation site that forgets to wrap the configuration in
 *   ``encodeURIComponent`` — the navigator we ship at
 *   ``create-config-dialog`` does encode (so ``#`` would survive as
 *   ``%23``), but ``configuration`` flows into other URL builders
 *   downstream too. Cheaper to drop ``#`` once here than to trust
 *   every consumer to encode.
 *
 * Surrounding whitespace and dots are also trimmed because Windows
 * silently strips trailing ones at write time, which would let
 * ``foo.yaml`` and ``foo .yaml`` collide.
 *
 * Windows reserved device names (``CON``, ``PRN``, ``AUX``, ``NUL``,
 * ``COM1``..``COM9``, ``LPT1``..``LPT9``, case-insensitive) are
 * suffixed with ``_`` so the resulting ``CON.yaml`` or ``CON.txt``
 * doesn't collide with the Windows console device. Windows treats
 * ``CON``, ``CON.txt``, and ``CON.txt.bak`` as the same device, so
 * we match on the part before the *first* dot in the stem and
 * insert the suffix there (``CON.txt`` → ``CON_.txt``).
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
  // Windows reserves the device name regardless of any trailing
  // extension — ``CON``, ``CON.txt``, ``AUX.mqtt``, ``COM1.backup``
  // are all unwritable. Detect on the part before the first dot and
  // insert the disambiguating ``_`` there so the rest of the
  // filename (``.txt``, ``.mqtt``, sub-extensions) is preserved.
  const firstDot = cleaned.indexOf(".");
  const beforeDot = firstDot === -1 ? cleaned : cleaned.slice(0, firstDot);
  if (WINDOWS_RESERVED_NAMES.has(beforeDot.toUpperCase())) {
    const tail = firstDot === -1 ? "" : cleaned.slice(firstDot);
    return `${beforeDot}_${tail}`;
  }
  return cleaned;
}
