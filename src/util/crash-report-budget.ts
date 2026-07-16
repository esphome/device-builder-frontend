/**
 * URL-budget accounting for the prefilled crash-report issue.
 *
 * GitHub answers 414 past roughly 8 KB of URL, so every field the report
 * packs in has to be measured against a shared budget and trimmed to fit.
 * Split out of crash-report.ts, which owns the scraping and the two
 * renderers; these are the primitives its per-field fitters share.
 */

export const TRIM_MARKER = "[log excerpt trimmed; full logs in the attached report]";

// Encoded length of *s* the way the prefilled URL actually serializes it:
// URLSearchParams uses application/x-www-form-urlencoded, which differs
// from encodeURIComponent for `! ~ ' ( )` (3 chars vs 1) — and ESPHome
// backtraces are full of parens, so encodeURIComponent under-counts and
// can produce a >8000-char URL (414). Measuring via URLSearchParams is
// exact; the trailing "v=" (2 chars) is subtracted off.
export const formEncodedLength = (s: string): number =>
  new URLSearchParams({ v: s }).toString().length - 2;

export const encodedCost = (line: string): number => formEncodedLength(`${line}\n`);

/**
 * Greedily take the longest prefix of *lines* whose per-line
 * `encodedCost` fits `budget - spent`. Returns the kept prefix, the
 * running spend, and whether any line was dropped.
 */
export function takeLinesUnderBudget(
  lines: string[],
  budget: number,
  spent: number
): { kept: string[]; spent: number; truncated: boolean } {
  const kept: string[] = [];
  for (const line of lines) {
    const cost = encodedCost(line);
    if (spent + cost > budget) return { kept, spent, truncated: true };
    kept.push(line);
    spent += cost;
  }
  return { kept, spent, truncated: false };
}

/**
 * Join as much of *lines* as fits *budget* once URL-encoded: the block
 * from *anchor* to the end first (truncating its tail if even that
 * overflows), then context lines walking backwards from the anchor.
 *
 * Two passes: the first spends the whole budget on content; only when
 * that truncates does the second re-fit with the trim marker's cost
 * reserved, so the marker never pushes the result past the budget and
 * an untrimmed excerpt never sacrifices content to an unused reserve.
 */
export function fitLines(lines: string[], anchor: number, budget: number): string {
  if (lines.length === 0 || budget <= 0) return "";
  let fit = fitWithReserve(lines, anchor, budget, 0);
  if (fit.truncated) {
    fit = fitWithReserve(lines, anchor, budget, encodedCost(TRIM_MARKER));
    fit.kept.push(TRIM_MARKER);
  }
  return fit.kept.length > (fit.truncated ? 1 : 0) ? fit.kept.join("\n") : "";
}

// Fit forward from *anchor* to the end, then walk backward over the
// preceding context, sharing one budget and marker reserve.
function fitWithReserve(
  lines: string[],
  anchor: number,
  budget: number,
  reserve: number
): { kept: string[]; truncated: boolean } {
  const forward = takeLinesUnderBudget(lines.slice(anchor), budget, reserve);
  const back = takeLinesUnderBudget(
    lines.slice(0, anchor).reverse(),
    budget,
    forward.spent
  );
  return {
    kept: [...back.kept.reverse(), ...forward.kept],
    truncated: forward.truncated || back.truncated,
  };
}
