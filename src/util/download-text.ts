import { stripAnsi } from "./strip-ansi.js";

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
  const text = lines.map(stripAnsi).join("\n");
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return text;
}
