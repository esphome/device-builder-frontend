/**
 * Sanitize a user-uploaded YAML filename's stem (without ``.yaml`` /
 * ``.yml``) for use as a configuration filename.
 *
 * The user's intent is "import my working config" — we should preserve
 * the existing filename character-for-character wherever the
 * filesystem allows it. That means underscores, hyphens, dots, accents,
 * and non-Latin scripts all round-trip; only characters that would
 * actually break a filesystem write are stripped.
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
 *
 * Surrounding whitespace and dots are also trimmed because Windows
 * silently strips trailing ones at write time, which would let
 * ``foo.yaml`` and ``foo .yaml`` collide.
 *
 * Returns the empty string when the input was made entirely of
 * stripped chars — the caller is responsible for surfacing that as a
 * user error (the backend rejects empty ``name`` with INVALID_ARGS).
 */
export function safeUploadFilename(stem: string): string {
  return stem
    .replace(/[/\\]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"|?*\x00-\x1f]/g, "")
    .replace(/^[\s.]+|[\s.]+$/g, "");
}
