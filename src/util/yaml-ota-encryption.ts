/**
 * Draft-buffer detection and rewrite for OTA encryption on the esphome
 * OTA platform. Line-level (not the section parser) so the edit keeps
 * comments and formatting, and detection works on mid-edit drafts.
 */
import { stripQuotes } from "./yaml-scalar.js";
import {
  _leadingIndent,
  isBlankOrCommentLine,
  LIST_ITEM_START_RE,
  TOP_LEVEL_KEY_START_RE,
} from "./yaml-section-lexer.js";
import { findDirectChildLine, findSectionStart } from "./yaml-section-reader.js";

const PLATFORM_RE = /^\s*(?:-\s+)?platform\s*:\s*([^\s#]+)/;
const ENCRYPTION_RE = /^encryption\s*:/;
const PASSWORD_RE = /^password\s*:/;
const KEY_VALUE_RE = /^key\s*:\s*([^\s#]|$)/;

/** The esphome OTA platform item in the draft. */
export interface OtaEsphomeItem {
  /** Zero-based line of `- platform: esphome` (or of `ota:` for the bare mapping form). */
  line: number;
  /** Indent of the item's own keys. */
  childIndent: string;
}

/** Locate the `- platform: esphome` item under top-level `ota:`, or the
 *  legacy bare mapping `ota:\n  platform: esphome`; `null` when absent. */
export function findOtaEsphomeItem(lines: string[]): OtaEsphomeItem | null {
  const start = findSectionStart(lines, "ota");
  if (start < 0) return null;
  let listIndent: string | null = null;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (isBlankOrCommentLine(l)) continue;
    if (TOP_LEVEL_KEY_START_RE.test(l)) break;
    if (LIST_ITEM_START_RE.test(l)) {
      const indent = _leadingIndent(l);
      if (listIndent === null) listIndent = indent;
      if (indent !== listIndent) continue;
      const childIndent = indent + " ".repeat(l.slice(indent.length).search(/[^-\s]/));
      if (itemPlatform(lines, i, childIndent) === "esphome")
        return { line: i, childIndent };
      continue;
    }
    if (listIndent === null) {
      // Bare mapping form: the block's own keys are the item.
      const childIndent = _leadingIndent(l);
      return itemPlatform(lines, start, childIndent) === "esphome"
        ? { line: start, childIndent }
        : null;
    }
  }
  return null;
}

/** What the draft's esphome OTA item already carries. */
export interface OtaEsphomeFacts {
  present: boolean;
  hasEncryption: boolean;
  hasPassword: boolean;
}

export function otaEsphomeFacts(yaml: string): OtaEsphomeFacts {
  const lines = yaml.split("\n");
  const item = findOtaEsphomeItem(lines);
  if (!item) return { present: false, hasEncryption: false, hasPassword: false };
  return {
    present: true,
    hasEncryption: findDirectChildLine(lines, "ota", ENCRYPTION_RE, item.line + 1) >= 0,
    hasPassword: findDirectChildLine(lines, "ota", PASSWORD_RE, item.line + 1) >= 0,
  };
}

/** Whether `api: encryption: key:` carries a value the CLI can read at build
 *  time (a literal, `!secret`, or a substitution). A keyless block is
 *  provisioned at runtime and does not count. */
export function hasStaticApiKey(yaml: string): boolean {
  const lines = yaml.split("\n");
  const encryption = findDirectChildLine(lines, "api", ENCRYPTION_RE);
  if (encryption < 0) return false;
  const key = findDirectChildLine(lines, "api", KEY_VALUE_RE, encryption + 1);
  if (key < 0) return false;
  const match = /^\s*key\s*:\s*(.*?)\s*$/.exec(lines[key]);
  const value = stripQuotes((match?.[1] ?? "").replace(/\s+#.*$/, ""));
  return value.length > 0;
}

/**
 * Add a bare `encryption:` to the esphome OTA item (inheriting the api
 * key) and drop its `password:` line; `null` when there is no item or it
 * already has `encryption:`.
 */
export function enableOtaEncryptionInYaml(yaml: string): string | null {
  const lines = yaml.split("\n");
  const item = findOtaEsphomeItem(lines);
  if (!item) return null;
  if (findDirectChildLine(lines, "ota", ENCRYPTION_RE, item.line + 1) >= 0) return null;
  const password = findDirectChildLine(lines, "ota", PASSWORD_RE, item.line + 1);
  const insertAt = password >= 0 ? password : item.line + 1;
  if (password >= 0) lines.splice(password, 1);
  lines.splice(insertAt, 0, `${item.childIndent}encryption:`);
  return lines.join("\n");
}

function itemPlatform(lines: string[], line: number, childIndent: string): string | null {
  const own = PLATFORM_RE.exec(lines[line]);
  if (own && LIST_ITEM_START_RE.test(lines[line])) return stripQuotes(own[1]);
  const platform = findDirectChildLine(lines, "ota", PLATFORM_RE, line + 1);
  if (platform < 0) return null;
  if (_leadingIndent(lines[platform]) !== childIndent) return null;
  return stripQuotes(PLATFORM_RE.exec(lines[platform])![1]);
}
