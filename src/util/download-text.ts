import { stripAnsi } from "./strip-ansi.js";

/**
 * Trigger a browser save of *bytes* as *filename* via an
 * anchor-click + revoked object URL.
 *
 * Centralises the "create a Blob, mint an object URL, click a
 * synthetic anchor, revoke" dance that every save-to-disk
 * path in the dashboard needs. Behaviour:
 *
 * - ``bytes`` rides through a single ``Blob`` with the given
 *   MIME type. Binary firmware images pass
 *   ``application/octet-stream`` so the browser doesn't try to
 *   sniff the type; text-shaped output (logs, manifests) passes
 *   ``text/plain``.
 * - ``filename`` is offered to the browser's save dialog as-is —
 *   callers own slug / extension shaping.
 * - The object URL is revoked synchronously after the click.
 *   Chromium / Firefox both keep the in-flight download alive
 *   after revocation; the URL just stops resolving for *new*
 *   reads. Holding the URL around would leak the underlying
 *   ``Blob`` for the page's lifetime.
 *
 * Private helper — call sites use the typed wrappers below
 * (:func:`downloadAnsiText`, :func:`downloadBase64Binary`)
 * rather than touching this directly.
 */
function _downloadBlob(bytes: BlobPart, filename: string, mimeType: string): void {
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Save a base64-encoded binary payload to the user's disk.
 *
 * Used by every install-related save path that hands the user
 * a firmware binary to flash with their own tooling:
 *
 * - :class:`ESPHomeFirmwareInstallDialog`'s manual-download
 *   install flow (post-compile save of the local-build output);
 * - :class:`ESPHomeDashboard`'s per-device "Download firmware"
 *   button on configured-device rows.
 *
 * ``b64`` is standard (not URL-safe) base64 — decoded via
 * ``atob`` + ``Uint8Array.from`` in one pass. Saves as
 * ``application/octet-stream`` so browsers don't sniff the
 * bytes as an executable / text / image. ``filename`` is
 * offered to the save dialog as-is; callers own extension
 * shaping (``.bin`` for firmware images, ``.uf2`` for
 * mass-storage flashes, etc.).
 */
export function downloadBase64Binary(b64: string, filename: string): void {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  _downloadBlob(bytes, filename, "application/octet-stream");
}

/**
 * Save terminal-style output to a plain text file.
 *
 * Used by the logs and command dialogs' download buttons. ANSI
 * colour-control sequences are stripped via the shared ``stripAnsi``
 * helper so the saved file reads cleanly in editors that don't
 * render them and the rest of the codebase's ANSI handling stays in
 * one place. The live dialog still keeps the colours.
 *
 * ``filename`` is offered to the browser's save dialog as-is —
 * callers do their own slug / extension shaping.
 *
 * Returns the joined text (without the trailing newline) so callers
 * — and tests — can assert on what would be saved without having to
 * re-parse the Blob.
 */
export function downloadAnsiText(lines: string[], filename: string): string {
  /* Some streams (notably the firmware-job follow path) deliver
     each line *with* its trailing ``\n`` / ``\r\n`` baked into the
     payload, and a few — esptool / PlatformIO progress lines that
     drive in-place updates — end on a bare ``\r``. Joining those
     with another ``\n`` produces blank rows or stray carriage
     returns in the saved file. Strip every trailing CR / LF combo
     per entry before the join so the output reads as one real log
     line per file row regardless of which terminator the upstream
     used. */
  const text = lines.map((line) => stripAnsi(line).replace(/[\r\n]+$/, "")).join("\n");
  _downloadBlob(text, filename, "text/plain");
  return text;
}
