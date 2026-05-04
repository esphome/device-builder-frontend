/**
 * Find YAML lines whose value is a sensitive credential — an inline
 * password, encryption key, or PSK — so the editor can mask them
 * visually. Mirrors the form, where the same fields render via
 * `<esphome-password-input>` with a hide/reveal toggle. Without this,
 * a user with the form's password field hidden still sees the raw
 * value sitting next to it in the YAML pane.
 *
 * NOT to be confused with ESPHome's `!secret <name>` tag (which
 * dereferences a value stored in `secrets.yaml`). The two are
 * orthogonal: `!secret foo` lines carry only the *name* of an
 * indirection, never the credential itself, and are deliberately
 * skipped here. The "Show/Hide secrets" feature elsewhere in the app
 * (see `show_secrets_tooltip` in translations) toggles whether
 * resolved `!secret` values appear in compile output — this file
 * masks raw inline credentials in the YAML the user is editing.
 *
 * Line-based scan (no full YAML parse) for the same reason
 * `config-entry-yaml-scan.ts` is line-based: the source is the user's
 * working YAML which may be mid-edit and not parseable.
 */

export interface SensitiveValueRange {
  /** 1-indexed line number (CodeMirror convention). */
  line: number;
  /** 0-indexed char offset within the line where the value begins. */
  valueFrom: number;
  /** 0-indexed char offset within the line where the value ends
   *  (exclusive). Excludes any trailing ` # comment`. */
  valueTo: number;
}

// Keys whose values are always credentials regardless of where they
// appear in the document. These names are stable across the ESPHome
// catalog (api/ota/mqtt/wifi/web_server/http_request all spell their
// credential fields the same way).
const ALWAYS_SENSITIVE_KEYS = new Set([
  "password",
  "ap_password",
  "ota_password",
  "psk",
]);

// Keys that are only credentials when they sit directly under a
// specific parent. `key:` is too generic to mask everywhere —
// `remote_receiver` and `remote_transmitter` use `key:` for
// non-sensitive button codes — so we restrict it to the parent blocks
// ESPHome uses for crypto material.
const PARENT_SCOPED_SENSITIVE_KEYS: Record<string, Set<string>> = {
  encryption: new Set(["key"]),
};

const KEY_LINE = /^(\s*)(-\s+)?([a-zA-Z_][a-zA-Z0-9_]*):(\s*)(.*)$/;
// Block-scalar header tail: `|`, `>`, optional chomping indicator (`+`/`-`),
// optional explicit indentation digit, optional trailing comment.
const BLOCK_SCALAR_HEADER = /^[|>][+-]?\d*\s*(#.*)?$/;

/** Find the closing quote of a YAML scalar starting at `quoteStart`,
 *  honouring the (limited) escapes both quote styles allow:
 *    - single-quoted: `''` is a literal `'`
 *    - double-quoted: `\"` is a literal `"`, but a `"` is only
 *      escaped when preceded by an *odd* number of backslashes
 *      (an even number means the backslashes themselves are paired
 *      escapes and the quote actually closes the scalar — e.g.
 *      `"ends with \\"` terminates at the final `"`).
 *  Returns the index of the closing quote, or -1 if the scalar runs
 *  past end-of-line (we treat that as "no comment can follow"). */
function findClosingQuote(line: string, quoteStart: number): number {
  const q = line[quoteStart];
  let k = quoteStart + 1;
  while (k < line.length) {
    if (line[k] === q) {
      if (q === "'" && line[k + 1] === "'") {
        k += 2;
        continue;
      }
      if (q === '"') {
        let backslashes = 0;
        for (let b = k - 1; b >= quoteStart + 1 && line[b] === "\\"; b--) {
          backslashes++;
        }
        if (backslashes % 2 === 1) {
          k++;
          continue;
        }
      }
      return k;
    }
    k++;
  }
  return -1;
}

/**
 * Minimal subset of CodeMirror's ``Text`` we need: 1-indexed line
 * access + total line count. Accepting the structural type instead
 * of a ``string`` lets the masking extension feed
 * ``EditorState.doc`` directly — no full-document stringify, no
 * ``split("\n")`` allocation per keystroke. The string overload is
 * kept for unit tests and any caller outside the editor (where
 * passing the raw YAML is the natural shape).
 */
interface LineSource {
  readonly lines: number;
  line(n: number): { readonly text: string };
}

function isLineSource(value: string | LineSource): value is LineSource {
  return typeof value !== "string";
}

export function findSensitiveValueRanges(
  yaml: string | LineSource,
): SensitiveValueRange[] {
  const ranges: SensitiveValueRange[] = [];
  let lines: string[];
  if (isLineSource(yaml)) {
    if (yaml.lines === 0) return ranges;
    lines = new Array<string>(yaml.lines);
    for (let n = 1; n <= yaml.lines; n++) lines[n - 1] = yaml.line(n).text;
  } else {
    if (!yaml) return ranges;
    lines = yaml.split("\n");
  }

  // Stack of (indent, key) entries representing the current ancestor
  // chain. When we encounter a key at indent N, every entry with
  // indent >= N is no longer an ancestor and is popped.
  const stack: Array<{ indent: number; key: string }> = [];

  // 0-indexed line cursor we advance manually so block-scalar bodies
  // (whose content can contain `:` and would otherwise be misparsed
  // as keys) are consumed by the block handler, not the outer loop.
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(KEY_LINE);
    if (!m) {
      i++;
      continue;
    }

    const leading = m[1];
    const dash = m[2] ?? "";
    const key = m[3];
    const sep = m[4];
    const rest = m[5];

    // For ancestor tracking, treat `- key:` items as living one level
    // deeper than their leading whitespace — this lets `encryption:`
    // (indent 2) correctly parent a `key:` inside `- ...` (indent 2
    // with leading dash) when ESPHome configs do that.
    const indent = leading.length + (dash ? dash.length : 0);

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    let sensitive = ALWAYS_SENSITIVE_KEYS.has(key);
    if (!sensitive && stack.length > 0) {
      const parent = stack[stack.length - 1].key;
      const allowed = PARENT_SCOPED_SENSITIVE_KEYS[parent];
      if (allowed && allowed.has(key)) sensitive = true;
    }

    stack.push({ indent, key });

    if (!sensitive) {
      i++;
      continue;
    }

    const trimmedRest = rest.trimStart();

    // Pure key (no inline value, no block scalar) or comment-only —
    // nothing to mask on this line.
    if (rest === "" || trimmedRest.startsWith("#")) {
      i++;
      continue;
    }

    // `!secret <name>` carries only the indirection name, not the
    // credential itself. Leave it as-is so the user can still see
    // which secret is being referenced.
    if (/^!secret\b/.test(trimmedRest)) {
      i++;
      continue;
    }

    // Block scalar (`|` / `>` with optional chomping/indent indicator):
    // the credential lives on the indented continuation lines, not on
    // this header line. Consume the whole block in one shot — masking
    // each non-blank continuation line and skipping past it so the
    // outer loop doesn't try to reinterpret content like `secret: x`
    // inside the block as YAML keys.
    if (BLOCK_SCALAR_HEADER.test(trimmedRest)) {
      // Use the *effective* indent (leading + dash) so a `- password: |`
      // list item terminates the block at the next sibling key in the
      // same item (which sits at `leading + dash` columns) instead of
      // greedily eating it as block content.
      const headerIndent = indent;
      let next = i + 1;
      while (next < lines.length) {
        const cont = lines[next];
        if (cont.trim() === "") {
          next++;
          continue;
        }
        const contIndent = (cont.match(/^(\s*)/)?.[1] ?? "").length;
        if (contIndent <= headerIndent) break;
        let valEnd = cont.length;
        while (valEnd > contIndent && /\s/.test(cont[valEnd - 1])) valEnd--;
        if (valEnd > contIndent) {
          ranges.push({ line: next + 1, valueFrom: contIndent, valueTo: valEnd });
        }
        next++;
      }
      i = next;
      continue;
    }

    const valueStart = leading.length + dash.length + key.length + 1 + sep.length;
    let valueEnd = line.length;

    // For comment-stripping purposes, a `#` only starts a comment when
    // preceded by whitespace AND outside any quoted scalar. So we
    // skip past a leading quoted string before looking for the `#`.
    let searchFrom = valueStart;
    const firstChar = trimmedRest[0];
    if (firstChar === '"' || firstChar === "'") {
      const quoteStart = valueStart + (rest.length - trimmedRest.length);
      const quoteEnd = findClosingQuote(line, quoteStart);
      if (quoteEnd !== -1) searchFrom = quoteEnd + 1;
      else searchFrom = line.length; // unterminated — treat rest as value
    }

    let commentIdx = -1;
    for (let k = searchFrom; k < line.length; k++) {
      if (line[k] === "#" && k > 0 && /\s/.test(line[k - 1])) {
        commentIdx = k;
        break;
      }
    }
    if (commentIdx !== -1) valueEnd = commentIdx;
    while (valueEnd > valueStart && /\s/.test(line[valueEnd - 1])) valueEnd--;

    if (valueEnd > valueStart) {
      ranges.push({ line: i + 1, valueFrom: valueStart, valueTo: valueEnd });
    }
    i++;
  }

  return ranges;
}
