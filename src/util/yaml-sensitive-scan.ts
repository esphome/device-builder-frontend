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

export function findSensitiveValueRanges(yaml: string): SensitiveValueRange[] {
  const ranges: SensitiveValueRange[] = [];
  if (!yaml) return ranges;

  const lines = yaml.split("\n");

  // Stack of (indent, key) entries representing the current ancestor
  // chain. When we encounter a key at indent N, every entry with
  // indent >= N is no longer an ancestor and is popped.
  const stack: Array<{ indent: number; key: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(KEY_LINE);
    if (!m) continue;

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

    if (!sensitive) continue;
    // No inline value (block scalar / nested mapping start) — nothing
    // to mask on this line.
    if (rest === "" || rest.trimStart().startsWith("#")) continue;

    // `!secret <name>` carries only the indirection name, not the
    // credential itself. Leave it as-is so the user can still see
    // *which* secret is being referenced.
    if (/^!secret\b/.test(rest.trimStart())) continue;

    const valueStart = leading.length + dash.length + key.length + 1 + sep.length;
    let valueEnd = line.length;

    // Strip trailing `  # comment`. The comment marker has to be
    // preceded by whitespace to avoid eating a `#` that's part of
    // a quoted value (`"abc#def"`).
    const commentMatch = rest.match(/(^|\s)#/);
    if (commentMatch && commentMatch.index !== undefined) {
      const commentRel = commentMatch.index + (commentMatch[1] === "" ? 0 : 1);
      valueEnd = valueStart + commentRel;
      // Trim trailing whitespace that sat between value and comment.
      while (valueEnd > valueStart && /\s/.test(line[valueEnd - 1])) {
        valueEnd--;
      }
    } else {
      // Trim trailing whitespace at end of line.
      while (valueEnd > valueStart && /\s/.test(line[valueEnd - 1])) {
        valueEnd--;
      }
    }

    if (valueEnd <= valueStart) continue;
    ranges.push({ line: i + 1, valueFrom: valueStart, valueTo: valueEnd });
  }

  return ranges;
}
