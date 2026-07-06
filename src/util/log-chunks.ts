/**
 * Fold raw process/log output chunks into visual lines.
 *
 * Pure string helpers shared by the log viewer — no DOM or Lit
 * dependency, so consumers (and tests) run under plain node.
 */
import { ANSI_LEADING_NON_SGR_RE, stripAnsi } from "./ansi-escapes.js";

/** Strip leading non-SGR ANSI controls and trailing whitespace. */
export function cleanLine(line: string): string {
  return line.replace(ANSI_LEADING_NON_SGR_RE, "").replace(/\s+$/, "");
}

/**
 * Fold ``\r``- and ``\n``-terminated output chunks into visual lines.
 *
 * An empty-after-cleaning chunk (PIO's ``\x1b[K\r`` between progress
 * ticks, a bare ``\r``) is a no-op that doesn't toggle the overwrite
 * flag; without that, the next real tick pops a non-progress line
 * above the bar instead of starting fresh (#840).
 */
export function chunksToVisualLines(chunks: string[]): string[] {
  const visual: string[] = [];
  let prevEndedInCR = false;
  for (const chunk of chunks) {
    const text = cleanLine(chunk.replace(/[\r\n]+$/, ""));
    const hasContent = stripAnsi(text).trim().length > 0;
    if (hasContent) {
      if (prevEndedInCR && chunk !== "\n" && visual.length > 0) {
        visual.pop();
      }
      visual.push(text);
      prevEndedInCR = chunk.endsWith("\r");
    } else if (chunk.endsWith("\n")) {
      prevEndedInCR = false;
    }
  }
  return visual;
}
