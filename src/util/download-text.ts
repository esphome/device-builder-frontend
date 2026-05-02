/**
 * Save terminal-style output to a plain text file.
 *
 * Used by the logs and command dialogs' download buttons. ANSI
 * colour-control sequences (``ESC [ ... m``) are stripped so the
 * saved file reads cleanly in editors that don't render them; the
 * live dialog still keeps the colours. ``filename`` is offered to
 * the browser's save dialog as-is — callers do their own slug /
 * extension shaping.
 */
const ANSI_COLOUR_RE = /\[[0-9;]*m/g;

export function downloadAnsiText(lines: string[], filename: string): void {
  const text = lines.map((line) => line.replace(ANSI_COLOUR_RE, "")).join("\n");
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
