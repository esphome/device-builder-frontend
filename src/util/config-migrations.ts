/**
 * Detection for the one-click config-migration nudge. Mirrors the
 * backend's `editor/migrate_config` rules (device-builder
 * `controllers/migrations.py`; new rules land on both sides): legacy
 * api spellings, homeassistant action node ids and body fields, and
 * the ethernet `clk_mode` conversion. Kept as a sync predicate so the
 * banner can gate render without a round trip; fires only when the
 * migration would change something.
 */
import { hasLegacyApiSpellings } from "./yaml-automations.js";
import { BLOCK_SCALAR_RE, isBlankOrCommentLine } from "./yaml-section-lexer.js";
import { _blockScalarBodyEnd } from "./yaml-section-list.js";
import { lineIndent } from "./yaml-sections-core.js";

/** Anchor for a homeassistant action node, under either registered id. */
const _HA_NODE_RE = /^(\s*(?:-\s+)?)homeassistant\.(service|action):(.*)$/;

/** The decodable ethernet clock mode the migration converts — upstream's
 *  closed mode table; anything else keeps failing validation loudly. */
const _CLK_MODE_RE = /^\s*clk_mode\s*:\s*(.+?)\s*$/;
const _CLK_MODES = new Set(["GPIO0_IN", "GPIO0_OUT", "GPIO16_OUT", "GPIO17_OUT"]);

/** Whether the buffer contains anything `editor/migrate_config` would
 *  rewrite. Single-entry memo, same shape as `parseYamlAutomations`. */
export function configNeedsMigration(yaml: string): boolean {
  if (_memoKey === yaml) return _memoValue;
  _memoKey = yaml;
  _memoValue = _configNeedsMigration(yaml);
  return _memoValue;
}

let _memoKey: string | undefined;
let _memoValue = false;

function _configNeedsMigration(yaml: string): boolean {
  const lines = yaml.split("\n");
  if (hasLegacyApiSpellings(lines)) return true;
  if (_hasEthernetClkMode(lines)) return true;
  const inScalar = _blockScalarMask(lines);
  for (let i = 0; i < lines.length; i++) {
    if (inScalar[i]) continue;
    const match = lines[i].match(_HA_NODE_RE);
    if (!match) continue;
    if (match[2] === "service") return true;
    const rest = match[3];
    if (rest.trimStart().startsWith("{")) {
      if (_flowHasLegacyField(rest)) return true;
      continue;
    }
    if (_bodyHasLegacyField(lines, i, match[1].length, inScalar)) return true;
  }
  return false;
}

function _hasEthernetClkMode(lines: string[]): boolean {
  let inEthernet = false;
  for (const line of lines) {
    if (/^ethernet\s*:/.test(line)) {
      inEthernet = true;
      continue;
    }
    if (inEthernet && /^\S/.test(line)) inEthernet = false;
    if (!inEthernet) continue;
    const match = line.match(_CLK_MODE_RE);
    if (match) {
      let value = match[1].replace(/\s#.*$/, "").trim();
      if (
        value.length >= 2 &&
        value[0] === value[value.length - 1] &&
        "\"'".includes(value[0])
      ) {
        value = value.slice(1, -1);
      }
      return _CLK_MODES.has(value.trim().toUpperCase().replace(/ /g, "_"));
    }
  }
  return false;
}

/** Depth-1 keys of the outer flow mapping only — a nested ``data:``
 *  payload key never counts, in either direction. */
function _flowHasLegacyField(rest: string): boolean {
  let depth = 0;
  let expectingKey = false;
  let legacy = false;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i += 1;
      while (i < rest.length && rest[i] !== quote) i += 1;
    } else if (ch === "{" || ch === "[") {
      depth += 1;
      expectingKey = depth === 1;
    } else if (ch === "}" || ch === "]") {
      depth -= 1;
    } else if (ch === "," && depth === 1) {
      expectingKey = true;
    } else if (depth === 1 && expectingKey && /\S/.test(ch)) {
      const name = rest.slice(i).match(/^[A-Za-z_][\w.]*/);
      if (name) {
        const end = i + name[0].length;
        if (rest.slice(end).trimStart().startsWith(":")) {
          if (name[0] === "action") return false;
          if (name[0] === "service") legacy = true;
        }
        i = end - 1;
      }
      expectingKey = false;
    }
  }
  return legacy;
}

/** The legacy field at exactly the node's child indent, with no
 *  canonical sibling there (the migration's collision skip). */
function _bodyHasLegacyField(
  lines: string[],
  anchor: number,
  contentCol: number,
  inScalar: boolean[]
): boolean {
  let childIndent: number | null = null;
  let legacy = false;
  for (let j = anchor + 1; j < lines.length; j++) {
    const body = lines[j];
    if (isBlankOrCommentLine(body)) continue;
    const leading = lineIndent(body);
    if (leading <= contentCol) break;
    if (inScalar[j]) continue;
    childIndent ??= leading;
    if (leading !== childIndent) continue;
    const key = /^ *([\w.]+)\s*:/.exec(body)?.[1];
    if (key === "action") return false;
    if (key === "service") legacy = true;
  }
  return legacy;
}

/** Mark lines inside ``|`` / ``>`` block scalars — never match those. */
function _blockScalarMask(lines: string[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (mask[i]) continue;
    if (!BLOCK_SCALAR_RE.test(lines[i])) continue;
    const end = _blockScalarBodyEnd(lines, i + 1, lineIndent(lines[i]));
    for (let j = i + 1; j <= end; j++) mask[j] = true;
  }
  return mask;
}
