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

export interface FindSensitiveValueRangesOptions {
  /** When true, every key/value pair is treated as sensitive — used
   *  for `secrets.yaml`, where the entire file is by definition a
   *  list of credentials and the per-key allowlist doesn't apply. */
  maskAllValues?: boolean;
  /** Keys the caller additionally treats as sensitive (may overlap the
   *  built-in allowlists), so wider heuristics (`*_password` suffixes)
   *  get the scanner's parent-scope and block-scalar handling. */
  sensitiveKeyPredicate?: (key: string) => boolean;
  /** Also scan commented-out lines: a comment's shadow text runs
   *  through the same key/value handling (allowlist + predicate only —
   *  a commented key has no live parent scope), emitting ranges at the
   *  real columns. A commented block-scalar header consumes the
   *  following comment run. */
  scanCommented?: boolean;
  /** Beside a sensitive key, also emit the inline comment's content as
   *  a range — a comment next to a credential routinely carries the
   *  credential itself. */
  emitCommentSpans?: boolean;
  /** Skip `${...}` reference values like `!secret` refs: both carry
   *  only the name of an indirection, never the credential. */
  skipSubstitutionRefs?: boolean;
}

// Keys whose values are always credentials regardless of where they
// appear in the document. These names are stable across the ESPHome
// catalog (api/ota/mqtt/wifi/web_server/http_request all spell their
// credential fields the same way).
const ALWAYS_SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  "password",
  "ap_password",
  "ota_password",
  "psk",
]);

// Keys that are only credentials when they sit directly under a
// specific parent. `key:` is too generic to mask everywhere —
// `remote_receiver` and `remote_transmitter` use `key:` for
// non-sensitive button codes — so we restrict it to the parent blocks
// ESPHome uses for crypto material. A Map, not a plain object, so an
// arbitrary user key like `constructor:` can't resolve a prototype
// member.
const PARENT_SCOPED_SENSITIVE_KEYS = new Map<string, Set<string>>([
  ["encryption", new Set(["key"])],
  // WPA2-Enterprise `key` is the client private key (often a whole PEM
  // block scalar). Its sibling certificates are public material and stay
  // visible in UI surfaces; the crash report masks them separately.
  ["eap", new Set(["key"])],
]);

// Plain-scalar key matcher. Permits hyphens and dots inside the
// key so user-defined secret names like `wifi-password:` or
// `mqtt.user:` are recognised — important for the secrets editor's
// `maskAllValues` mode where every key/value pair is supposed to
// be masked. The leading-character class stays restrictive
// (`[a-zA-Z_]`) so we don't pick up numeric scalars or list
// dashes as keys. Quoted keys (`"my key": …`) are still not
// matched; they're rare enough in ESPHome configs and
// `secrets.yaml` that we accept the limitation.
const KEY_LINE = /^(\s*)(-\s+)?([a-zA-Z_][a-zA-Z0-9_.\-]*)(\s*):(\s*)(.*)$/;
// Block-scalar header tail: `|`, `>`, optional chomping indicator (`+`/`-`),
// optional explicit indentation digit, optional trailing comment.
const BLOCK_SCALAR_HEADER = /^[|>][+-]?\d*\s*(#.*)?$/;

// A `!secret` tag value — carries only the indirection name. Word-bounded
// so a literal merely starting with "!secret" doesn't pass. Deliberately
// NOT secret-ref.ts's fully anchored SECRET_REF_RE: the scanner must
// tolerate a trailing comment after the name (whose body it masks).
const SECRET_TAG_VALUE = /^!secret\b/;

// A `${substitution}` reference value — the other indirection shape,
// skipped only under `skipSubstitutionRefs`. Deliberately NOT
// substitutions.ts's contains-style matchers: a literal merely
// containing `${...}` must still mask.
const SUBSTITUTION_REF = /^\$\{/;

// A commented-out line, split into the marker prefix (a list dash may
// sit before the marker: `- # password:`) and the shadow text after it.
const COMMENT_SHADOW = /^(\s*(?:-\s+)?#+)(.*)$/;

// A comment line split into marker and content, for walking a commented
// block-scalar's body run.
const COMMENT_LINE = /^(\s*#+)\s*(.*)$/;

// Leading whitespace, shared by the block-consumption rules.
const LEADING_WHITESPACE = /^(\s*)/;

// A single whitespace character.
const WHITESPACE_CHAR = /\s/;

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
  options: FindSensitiveValueRangesOptions = {}
): SensitiveValueRange[] {
  const {
    maskAllValues = false,
    sensitiveKeyPredicate,
    scanCommented = false,
    emitCommentSpans = false,
    skipSubstitutionRefs = false,
  } = options;
  const ranges: SensitiveValueRange[] = [];
  // Trailing CRs are stripped at materialization: `.` excludes line
  // terminators in JS, so a line keeping its CR cannot satisfy patterns
  // ending `(.*)$` and would silently fail open. Emitted columns stay
  // valid in the caller's CR-bearing original — the CR is line-final.
  let lines: string[];
  if (isLineSource(yaml)) {
    if (yaml.lines === 0) return ranges;
    lines = new Array<string>(yaml.lines);
    for (let n = 1; n <= yaml.lines; n++) {
      lines[n - 1] = stripTrailingCr(yaml.line(n).text);
    }
  } else {
    if (!yaml) return ranges;
    lines = yaml.split("\n").map(stripTrailingCr);
  }

  // Stack of (indent, key) entries representing the current ancestor
  // chain. When we encounter a key at indent N, every entry with
  // indent >= N is no longer an ancestor and is popped.
  const stack: Array<{ indent: number; key: string }> = [];

  // Trim trailing whitespace off [from, to) and push the range when
  // anything remains.
  const pushTrimmedRange = (lineIdx: number, from: number, to: number) => {
    const line = lines[lineIdx];
    while (to > from && WHITESPACE_CHAR.test(line[to - 1])) to--;
    if (to > from) ranges.push({ line: lineIdx + 1, valueFrom: from, valueTo: to });
  };

  // Under `emitCommentSpans`, push the content span of the first comment
  // at or after *from*.
  const pushCommentSpan = (lineIdx: number, from: number) => {
    if (!emitCommentSpans) return;
    const line = lines[lineIdx];
    const hashIdx = findCommentIdx(line, from);
    if (hashIdx === -1) return;
    const span = commentContentSpan(line, hashIdx);
    if (span) ranges.push({ line: lineIdx + 1, valueFrom: span.from, valueTo: span.to });
  };

  // Inline-value handling shared by the live and commented paths: emit
  // the value range (honouring the indirection skips) and, opted in,
  // the comment-content span. Returns "block" when the value is a
  // block-scalar header — the caller consumes the body with its own
  // rule (real indent for live lines, the comment-run boundary for
  // commented ones).
  const emitInlineRanges = (
    lineIdx: number,
    valueStart: number,
    trimmedRest: string
  ): "block" | "done" => {
    const line = lines[lineIdx];

    // A `#`-leading value IS the comment; its marker needs no
    // whitespace guard (`password:#hunter2` is still a leak), so the
    // span comes straight off the marker position.
    if (trimmedRest.startsWith("#")) {
      if (emitCommentSpans) {
        const span = commentContentSpan(line, line.indexOf("#", valueStart));
        if (span) {
          ranges.push({ line: lineIdx + 1, valueFrom: span.from, valueTo: span.to });
        }
      }
      return "done";
    }
    // Value-less shapes share one action — mask only the comment, which
    // can hide the credential: an empty value, an indirection (it
    // carries only a name), or a block-scalar header (its credential
    // lives on the body lines).
    const isBlock = BLOCK_SCALAR_HEADER.test(trimmedRest);
    if (
      isBlock ||
      trimmedRest === "" ||
      SECRET_TAG_VALUE.test(trimmedRest) ||
      (skipSubstitutionRefs && SUBSTITUTION_REF.test(trimmedRest))
    ) {
      pushCommentSpan(lineIdx, valueStart);
      return isBlock ? "block" : "done";
    }

    // For comment-stripping purposes, a `#` only starts a comment when
    // preceded by whitespace AND outside any quoted scalar. So we
    // skip past a leading quoted string before looking for the `#`.
    let searchFrom = valueStart;
    const firstChar = trimmedRest[0];
    if (firstChar === '"' || firstChar === "'") {
      const quoteStart = valueStart + (line.length - valueStart - trimmedRest.length);
      const quoteEnd = findClosingQuote(line, quoteStart);
      if (quoteEnd !== -1) searchFrom = quoteEnd + 1;
      else searchFrom = line.length; // unterminated — treat rest as value
    }
    const commentIdx = findCommentIdx(line, searchFrom);
    pushTrimmedRange(lineIdx, valueStart, commentIdx !== -1 ? commentIdx : line.length);
    if (commentIdx !== -1) pushCommentSpan(lineIdx, commentIdx);
    return "done";
  };

  // A commented sensitive key line: shadow-parse it, emit its inline
  // ranges, and consume a commented block-scalar's body run. Returns
  // the next line index.
  const scanCommentedLine = (lineIdx: number, markerLen: number): number => {
    const line = lines[lineIdx];
    const shadow = line.slice(markerLen);
    const sm = shadow.match(KEY_LINE);
    if (!sm) return lineIdx + 1;
    const [, sLeading, sDash = "", sKey, sPreColon, sSep, sRest] = sm;
    // No live parent scope inside a comment — allowlist and predicate only.
    const sensitive =
      maskAllValues ||
      ALWAYS_SENSITIVE_KEYS.has(sKey.toLowerCase()) ||
      sensitiveKeyPredicate?.(sKey) === true;
    if (!sensitive) return lineIdx + 1;

    const valueStart =
      markerLen +
      sLeading.length +
      sDash.length +
      sKey.length +
      sPreColon.length +
      1 +
      sSep.length;
    if (emitInlineRanges(lineIdx, valueStart, sRest.trimStart()) !== "block") {
      return lineIdx + 1;
    }

    // Commented block-scalar body run. Boundary: bodies mask while their
    // content column exceeds the header's key column; marker-adjacent
    // content (``#hunter2``) is always body — its column is ambiguous,
    // and skipping it would leak; spaced content at or above the header
    // column ends the run.
    const headerColumn = markerLen + sLeading.length + sDash.length;
    let next = lineIdx + 1;
    while (next < lines.length) {
      const cont = lines[next];
      const cm = cont.match(COMMENT_LINE);
      if (!cm) break;
      if (!cm[2]) {
        next++;
        continue;
      }
      const contentColumn = cont.length - cm[2].length;
      if (contentColumn > cm[1].length && contentColumn <= headerColumn) break;
      pushTrimmedRange(next, contentColumn, cont.length);
      next++;
    }
    return next;
  };

  // 0-indexed line cursor we advance manually so block-scalar bodies
  // (whose content can contain `:` and would otherwise be misparsed
  // as keys) are consumed by the block handler, not the outer loop.
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(KEY_LINE);
    if (!m) {
      if (scanCommented) {
        const c = line.match(COMMENT_SHADOW);
        if (c) {
          i = scanCommentedLine(i, c[1].length);
          continue;
        }
      }
      i++;
      continue;
    }

    const leading = m[1];
    const dash = m[2] ?? "";
    const key = m[3];
    const preColon = m[4];
    const sep = m[5];
    const rest = m[6];
    // Sensitivity checks and ancestor tracking case-fold the key: the
    // input may be YAML esphome would reject, and a mis-capitalized
    // `Encryption:` must still scope the `key:` under it.
    const keyFolded = key.toLowerCase();

    // For ancestor tracking, treat `- key:` items as living one level
    // deeper than their leading whitespace — this lets `encryption:`
    // (indent 2) correctly parent a `key:` inside `- ...` (indent 2
    // with leading dash) when ESPHome configs do that.
    const indent = leading.length + (dash ? dash.length : 0);

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    let sensitive: boolean;
    if (maskAllValues) {
      sensitive = true;
    } else {
      sensitive = ALWAYS_SENSITIVE_KEYS.has(keyFolded);
      if (!sensitive && stack.length > 0) {
        const parent = stack[stack.length - 1].key;
        const allowed = PARENT_SCOPED_SENSITIVE_KEYS.get(parent);
        if (allowed && allowed.has(keyFolded)) sensitive = true;
      }
      if (!sensitive && sensitiveKeyPredicate) sensitive = sensitiveKeyPredicate(key);
    }

    stack.push({ indent, key: keyFolded });

    if (!sensitive) {
      i++;
      continue;
    }

    const valueStart =
      leading.length + dash.length + key.length + preColon.length + 1 + sep.length;
    if (emitInlineRanges(i, valueStart, rest.trimStart()) !== "block") {
      i++;
      continue;
    }

    // Block scalar (`|` / `>` with optional chomping/indent indicator):
    // the credential lives on the indented continuation lines, not on
    // the header line. Consume the whole block in one shot — masking
    // each non-blank continuation line and skipping past it so the
    // outer loop doesn't try to reinterpret content like `secret: x`
    // inside the block as YAML keys. Use the *effective* indent
    // (leading + dash) so a `- password: |` list item terminates the
    // block at the next sibling key in the same item (which sits at
    // `leading + dash` columns) instead of greedily eating it as block
    // content.
    let next = i + 1;
    while (next < lines.length) {
      const cont = lines[next];
      if (cont.trim() === "") {
        next++;
        continue;
      }
      // Deliberately whitespace-generic, NOT `indentOf` (spaces-only):
      // `contIndent` doubles as the mask's start column, and the
      // header indent it's compared against comes from KEY_LINE's
      // `(\s*)` capture. Mid-edit input may be invalid YAML; a
      // spaces-only count would end the block at a tab-led line and
      // leave the credential on it unmasked.
      const contIndent = (cont.match(LEADING_WHITESPACE)?.[1] ?? "").length;
      if (contIndent <= indent) break;
      pushTrimmedRange(next, contIndent, cont.length);
      next++;
    }
    i = next;
  }

  return ranges;
}

function stripTrailingCr(text: string): string {
  return text.endsWith("\r") ? text.slice(0, -1) : text;
}

// First `#` at or after *from* that begins a comment (whitespace-preceded).
function findCommentIdx(line: string, from: number): number {
  for (let k = from; k < line.length; k++) {
    if (line[k] === "#" && k > 0 && WHITESPACE_CHAR.test(line[k - 1])) return k;
  }
  return -1;
}

// The comment's content span (after the marker and its spacing, to the
// trimmed end), or null when the comment is empty.
function commentContentSpan(
  line: string,
  hashIdx: number
): { from: number; to: number } | null {
  let from = hashIdx + 1;
  while (from < line.length && WHITESPACE_CHAR.test(line[from])) from++;
  let to = line.length;
  while (to > from && WHITESPACE_CHAR.test(line[to - 1])) to--;
  return to > from ? { from, to } : null;
}
