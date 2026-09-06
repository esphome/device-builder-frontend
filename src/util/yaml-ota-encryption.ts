/**
 * Draft-buffer detection and rewrite for OTA encryption on the esphome
 * OTA platform. Line-level (not the section parser's values) so the
 * edit keeps comments and formatting, and detection works on mid-edit
 * drafts; item discovery rides the navigator's section parser so the
 * nudge agrees with the surface the user is looking at.
 */
import { splitInlineComment, stripQuotes } from "./yaml-scalar.js";
import { _detectSectionChildIndent } from "./yaml-section-lexer.js";
import { findDirectChildLine } from "./yaml-section-reader.js";
import { parseYamlTopLevelSections } from "./yaml-sections-core.js";

const ENCRYPTION_RE = /^encryption\s*:/;
const PASSWORD_RE = /^password\s*:/;
const KEY_VALUE_RE = /^key\s*:\s*([^\s#]|$)/;
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
}

/** What the draft's esphome OTA item already carries. */
export interface OtaEsphomeFacts {
  present: boolean;
  hasEncryption: boolean;
  hasPassword: boolean;
  /** The `encryption:` block carries its own `key:` instead of inheriting the api key. */
  hasOwnKey: boolean;
}

export function otaEsphomeFacts(yaml: string): OtaEsphomeFacts {
  const item = locate(yaml, yaml.split("\n"));
  return {
    present: item !== null,
    hasEncryption: !!item && item.encryptionLine >= 0,
    hasPassword: !!item && item.passwordLine >= 0,
    hasOwnKey: !!item && item.keyLine >= 0,
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
  const raw = lines[key].replace(/^\s*key\s*:\s*/, "");
  return stripQuotes(splitInlineComment(raw).value.trim()).length > 0;
}

/**
 * Add a bare `encryption:` to the esphome OTA item (inheriting the api
 * key) and drop its `password:` line; `null` when there is no item or it
 * already has `encryption:`.
 */
export function enableOtaEncryptionInYaml(yaml: string): string | null {
  const lines = yaml.split("\n");
  const item = locate(yaml, lines);
  if (!item || item.encryptionLine >= 0) return null;
  const insertAt = item.passwordLine >= 0 ? item.passwordLine : item.line + 1;
  if (item.passwordLine >= 0) lines.splice(item.passwordLine, 1);
  lines.splice(insertAt, 0, `${item.childIndent}encryption:`);
  return lines.join("\n");
}

/** Drop the `key:` under the esphome OTA item's `encryption:` so the block
 *  inherits the api key; `null` when there is no such key. */
export function dropOtaEncryptionKeyInYaml(yaml: string): string | null {
  const lines = yaml.split("\n");
  const item = locate(yaml, lines);
  if (!item || item.keyLine < 0) return null;
  lines.splice(item.keyLine, 1);
  return lines.join("\n");
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
  return {
    line,
    childIndent: _detectSectionChildIndent(lines, line, section.parentKey !== undefined),
    encryptionLine,
    passwordLine: findDirectChildLine(lines, "ota", PASSWORD_RE, section.fromLine),
    keyLine:
      encryptionLine >= 0
        ? findDirectChildLine(lines, "ota", KEY_RE, encryptionLine + 1)
        : -1,
  };
}
