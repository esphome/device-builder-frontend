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
 * Private helper — call sites use :func:`downloadAnsiText` rather than
 * touching this directly. (Binary artifacts download natively via
 * :func:`triggerDownload`, which streams from a URL and skips this.)
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
 * Trigger a native browser download of a (same-origin) URL.
 *
 * Unlike the blob helpers this doesn't buffer the file in memory — the browser
 * streams the response straight to disk, so it scales to large artifacts (the
 * ~14 MB firmware.elf) and works on mobile where programmatic blob downloads
 * are unreliable. The server's ``Content-Disposition`` names the saved file;
 * ``filename`` is only a same-origin hint.
 */
export function triggerDownload(url: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
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
