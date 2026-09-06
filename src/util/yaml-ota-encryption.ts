/** Draft-buffer detection and rewrite for OTA encryption on the esphome OTA platform. */
import { splitYamlDocLines, yamlDocEol } from "./yaml-doc-lines.js";
import { splitInlineComment, stripQuotes } from "./yaml-scalar.js";
import {
  _detectSectionChildIndent,
  BLOCK_SCALAR_RE,
  isBlankOrCommentLine,
} from "./yaml-section-lexer.js";
import { findDirectChildLine } from "./yaml-section-reader.js";
import { lineIndent, parseYamlTopLevelSections } from "./yaml-sections-core.js";

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
  /** A `password:` or `key:` value spans several lines. */
  multiLine: boolean;
}

/** What the draft's esphome OTA item already carries. */
export interface OtaEsphomeFacts {
  present: boolean;
  hasEncryption: boolean;
  hasPassword: boolean;
  /** The `encryption:` block carries its own `key:` instead of inheriting the api key. */
  hasOwnKey: boolean;
  /** False when a value spans several lines. */
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

/** Whether `api: encryption: key:` has a build-time value (literal, `!secret`, or substitution). */
export function hasStaticApiKey(yaml: string): boolean {
  const lines = splitYamlDocLines(yaml);
  const encryption = findDirectChildLine(lines, "api", ENCRYPTION_RE);
  if (encryption < 0) return false;
  // Last key wins, so pick the line first and read its value after.
  const key = findDirectChildLine(lines, "api", KEY_RE, encryption + 1);
  if (key < 0) return false;
  // Keep the space after the colon; the comment splitter needs it to see `#`.
  const raw = lines[key].replace(/^\s*key\s*:/, "");
  const value = stripQuotes(splitInlineComment(raw).value.trim());
  return value.length > 0 && !/^!\S*$/.test(value);
}

/**
 * Add a bare `encryption:` to the esphome OTA item and drop its `password:` lines.
 *
 * `null` when there is no item or it already has `encryption:`. Comment
 * lines stay where they are.
 */
export function enableOtaEncryptionInYaml(yaml: string): string | null {
  const lines = splitYamlDocLines(yaml);
  const item = locate(yaml, lines);
  if (!item || item.encryptionLine >= 0 || item.multiLine) return null;
  // A password inline on the dash is swapped in place, whether or not a
  // duplicate child line exists too.
  const dash = /^(\s*-\s+)password\s*:(.*)$/.exec(lines[item.line]);
  if (dash) {
    lines[item.line] = `${dash[1]}encryption:${splitInlineComment(dash[2]).comment}`;
  }
  const platform = findDirectChildLine(lines, "ota", PLATFORM_RE, item.line + 1);
  const removed = removeDirectChildLines(lines, PASSWORD_RE, item.line + 1);
  if (!dash) {
    const insertAt =
      removed >= 0 ? removed : platform >= 0 ? platform + 1 : item.line + 1;
    lines.splice(insertAt, 0, `${item.childIndent}encryption:`);
  }
  return lines.join(yamlDocEol(yaml));
}

/** Drop the `key:` lines under the item's `encryption:`; `null` when there are none. */
export function dropOtaEncryptionKeyInYaml(yaml: string): string | null {
  const lines = splitYamlDocLines(yaml);
  const item = locate(yaml, lines);
  if (!item || item.keyLine < 0 || item.multiLine) return null;
  removeDirectChildLines(lines, KEY_RE, item.encryptionLine + 1);
  return lines.join(yamlDocEol(yaml));
}

/** Splice out every direct-child line below `fromLine` matching `keyRe` (the dash
 *  line itself is left to the caller); returns the first removed index, or -1. */
function removeDirectChildLines(
  lines: string[],
  keyRe: RegExp,
  fromLine: number
): number {
  let first = -1;
  for (let line = childBelowDash(lines, keyRe, fromLine); line >= 0;) {
    lines.splice(line, 1);
    first = line;
    line = childBelowDash(lines, keyRe, fromLine);
  }
  return first;
}

/** `findDirectChildLine` without the dash line, so removal never eats the item's dash. */
function childBelowDash(lines: string[], keyRe: RegExp, fromLine: number): number {
  const line = findDirectChildLine(lines, "ota", keyRe, fromLine);
  return line === fromLine - 1 ? -1 : line;
}

function locate(yaml: string, lines: string[]): OtaEsphomeItem | null {
  const section = parseYamlTopLevelSections(yaml).find(
    (s) => s.key === "ota" && s.platform === "esphome"
  );
  if (!section) return null;
  const line = section.fromLine - 1;
  const encryptionLine = findDirectChildLine(
    lines,
    "ota",
    ENCRYPTION_RE,
    section.fromLine
  );
  const passwordLine = findDirectChildLine(lines, "ota", PASSWORD_RE, section.fromLine);
  const keyLine =
    encryptionLine >= 0
      ? findDirectChildLine(lines, "ota", KEY_RE, encryptionLine + 1)
      : -1;
  const childIndent = _detectSectionChildIndent(
    lines,
    line,
    section.parentKey !== undefined
  );
  return {
    line,
    childIndent,
    encryptionLine,
    passwordLine,
    keyLine,
    // A key on the dash compares against the item's child column, not the dash.
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

/** Whether the scalar on `idx` is a block scalar or continues past `floor`'s indent. */
function continuesOnNextLine(lines: string[], idx: number, floor: string): boolean {
  if (BLOCK_SCALAR_RE.test(lines[idx])) return true;
  const indent = Math.max(lineIndent(lines[idx]), floor.length);
  for (let i = idx + 1; i < lines.length; i++) {
    if (isBlankOrCommentLine(lines[i])) continue;
    return lineIndent(lines[i]) > indent;
  }
  return false;
}
