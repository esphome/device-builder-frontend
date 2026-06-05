/**
 * Split *s* on top-level commas, ignoring commas inside single- or
 * double-quoted spans (``\"`` escapes are honored inside double quotes).
 * Returns the raw segments between delimiters — callers trim / unquote.
 *
 * A quote-unaware ``split(",")`` fractures a quoted element that itself
 * contains a comma (e.g. a YAML flow list ``["a,b", "c"]``); this keeps
 * such elements intact.
 */
export function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let buf = "";
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      buf += c;
      if (quote === '"' && c === "\\" && i + 1 < s.length) buf += s[++i];
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      buf += c;
    } else if (c === ",") {
      out.push(buf);
      buf = "";
    } else {
      buf += c;
    }
  }
  out.push(buf);
  return out;
}
