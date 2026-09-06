/**
 * Draft-buffer detection and rewrite for OTA encryption on the esphome
 * OTA platform. Line-level (not the section parser's values) so the
 * edit keeps comments and formatting, and detection works on mid-edit
 * drafts; item discovery rides the navigator's section parser so the
 * nudge agrees with the surface the user is looking at.
 */
import { splitYamlDocLines, yamlDocEol } from "./yaml-doc-lines.js";
import { splitInlineComment, stripQuotes } from "./yaml-scalar.js";
import {
  _detectSectionChildIndent,
  _leadingIndent,
  isBlankOrCommentLine,
} from "./yaml-section-lexer.js";
import { findDirectChildLine } from "./yaml-section-reader.js";
import { parseYamlTopLevelSections } from "./yaml-sections-core.js";

const ENCRYPTION_RE = /^encryption\s*:/;
const PASSWORD_RE = /^password\s*:/;
const PLATFORM_RE = /^platform\s*:/;
const KEY_RE = /^key\s*:/;

interface OtaEsphomeItem {
  /** Zero-based line of the item (its dash, or `ota:` for the bare mapping form). */
  line: number;
  childIndent: string;
  /** Zero-based line of the item's direct-child key, or -1. */
  encryptionLine: number;
  passwordLine: number;
  /** Zero-based line of `key:` inside the item's `encryption:` block, or -1. */
  keyLine: number;
  /** A `password:` or `key:` value continues on following lines (block scalar,
   *  value on its own line), which the one-line splices cannot handle. */
  multiLine: boolean;
}

/** What the draft's esphome OTA item already carries. */
export interface OtaEsphomeFacts {
  present: boolean;
  hasEncryption: boolean;
  hasPassword: boolean;
  /** The `encryption:` block carries its own `key:` instead of inheriting the api key. */
  hasOwnKey: boolean;
  /** False when a value spans several lines, so neither rewrite can edit it safely. */
  rewritable: boolean;
}

export function otaEsphomeFacts(yaml: string): OtaEsphomeFacts {
  const item = locate(yaml, splitYamlDocLines(yaml));
  return {
    present: item !== null,
    hasEncryption: !!item && item.encryptionLine >= 0,
    hasPassword: !!item && item.passwordLine >= 0,
    hasOwnKey: !!item && item.keyLine >= 0,
    rewritable: !!item && !item.multiLine,
  };
}

/** Whether `api: encryption: key:` carries a value the CLI can read at build
 *  time (a literal, `!secret`, or a substitution). A keyless block is
 *  provisioned at runtime and does not count. */
export function hasStaticApiKey(yaml: string): boolean {
  const lines = splitYamlDocLines(yaml);
  const encryption = findDirectChildLine(lines, "api", ENCRYPTION_RE);
  if (encryption < 0) return false;
  // Last key wins, so pick the last `key:` line before reading its value; a
  // regex that needs a value would skip a trailing empty or comment-only one.
  const key = findDirectChildLine(lines, "api", KEY_RE, encryption + 1);
  if (key < 0) return false;
  // Keep the space after the colon: the comment splitter needs it to see `#`.
  const raw = lines[key].replace(/^\s*key\s*:/, "");
  const value = stripQuotes(splitInlineComment(raw).value.trim());
  // A bare `!secret` with no name is not a usable reference.
  return value.length > 0 && !/^!\S*$/.test(value);
}

/**
 * Add a bare `encryption:` to the esphome OTA item (inheriting the api
 * key) and drop its `password:` line; `null` when there is no item or it
 * already has `encryption:`.
 */
export function enableOtaEncryptionInYaml(yaml: string): string | null {
  const lines = splitYamlDocLines(yaml);
  const item = locate(yaml, lines);
  if (!item || item.encryptionLine >= 0 || item.multiLine) return null;
  if (item.passwordLine === item.line) {
    // The password sits inline on the item's dash: swap the key in place.
    lines[item.line] = lines[item.line].replace(/password\s*:.*$/, "encryption:");
  }
  // Duplicate keys are legal YAML (last wins), so every password line goes;
  // the block lands where the first one was, else after `platform:` (which a
  // bare-dash item carries on its own line, not on the dash).
  const platform = findDirectChildLine(lines, "ota", PLATFORM_RE, item.line + 1);
  let insertAt = platform >= 0 ? platform + 1 : item.line + 1;
  for (
    let line = findDirectChildLine(lines, "ota", PASSWORD_RE, item.line + 1);
    line >= 0;
  ) {
    lines.splice(line, 1);
    insertAt = line;
    line = findDirectChildLine(lines, "ota", PASSWORD_RE, item.line + 1);
  }
  if (item.passwordLine !== item.line) {
    lines.splice(insertAt, 0, `${item.childIndent}encryption:`);
  }
  return lines.join(yamlDocEol(yaml));
}

/** Drop the `key:` under the esphome OTA item's `encryption:` so the block
 *  inherits the api key; `null` when there is no such key. */
export function dropOtaEncryptionKeyInYaml(yaml: string): string | null {
  const lines = splitYamlDocLines(yaml);
  const item = locate(yaml, lines);
  if (!item || item.keyLine < 0 || item.multiLine) return null;
  for (let line = item.keyLine; line >= 0;) {
    lines.splice(line, 1);
    line = findDirectChildLine(lines, "ota", KEY_RE, item.encryptionLine + 1);
  }
  return lines.join(yamlDocEol(yaml));
}

function locate(yaml: string, lines: string[]): OtaEsphomeItem | null {
  const section = parseYamlTopLevelSections(yaml).find(
    (s) => s.key === "ota" && s.platform === "esphome"
  );
  if (!section) return null;
  const line = section.fromLine - 1;
  const isListItem = section.parentKey !== undefined;
  // A key written inline on the dash (`- password: x`) is a child too, but
  // `findDirectChildLine` starts below the dash, so test the dash itself.
  const dashKey = isListItem ? lines[line].replace(/^\s*-\s+/, "") : "";
  const childEncryption = findDirectChildLine(
    lines,
    "ota",
    ENCRYPTION_RE,
    section.fromLine
  );
  const childPassword = findDirectChildLine(lines, "ota", PASSWORD_RE, section.fromLine);
  const encryptionLine =
    childEncryption >= 0 || !ENCRYPTION_RE.test(dashKey) ? childEncryption : line;
  const passwordLine =
    childPassword >= 0 || !PASSWORD_RE.test(dashKey) ? childPassword : line;
  const keyLine =
    encryptionLine >= 0
      ? findDirectChildLine(lines, "ota", KEY_RE, encryptionLine + 1)
      : -1;
  const childIndent = _detectSectionChildIndent(lines, line, isListItem);
  return {
    line,
    childIndent,
    encryptionLine,
    passwordLine,
    keyLine,
    multiLine:
      (passwordLine >= 0 &&
        continuesOnNextLine(
          lines,
          passwordLine,
          passwordLine === line ? childIndent : ""
        )) ||
      (keyLine >= 0 && continuesOnNextLine(lines, keyLine, "")),
  };
}

/** Whether the scalar on `idx` is a block scalar or continues on a deeper line.
 *  `floor` is the indent a continuation must exceed; for a key on the item's
 *  dash that is the item's child indent, since sibling keys sit deeper than
 *  the dash itself. */
function continuesOnNextLine(lines: string[], idx: number, floor: string): boolean {
  const value = splitInlineComment(lines[idx].replace(/^[^:]*:/, "")).value.trim();
  if (/^[|>]/.test(value)) return true;
  const indent = Math.max(_leadingIndent(lines[idx]).length, floor.length);
  for (let i = idx + 1; i < lines.length; i++) {
    if (isBlankOrCommentLine(lines[i])) continue;
    return _leadingIndent(lines[i]).length > indent;
  }
  return false;
}
