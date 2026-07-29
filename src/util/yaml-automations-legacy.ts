/**
 * Legacy renamed-key spelling detection for the migrate nudge. Mirrors
 * the backend canonicalizer's anchors — api ``services:`` block key,
 * ``- service:`` item discriminators, ``homeassistant.service`` node
 * ids, and the legacy ``service:`` field at a homeassistant node's own
 * child indent — so the nudge and the rewrite can't disagree: it fires
 * only when the canonicalizer would change something.
 */
import {
  _enumerateListItems,
  _findChildBlock,
  _findTopLevelBlock,
  _readKeyOnLine,
  API_ACTIONS_BLOCK_KEYS,
} from "./yaml-automations.js";
import { isBlankOrCommentLine } from "./yaml-section-lexer.js";
import { lineIndent } from "./yaml-sections-core.js";

/** Anchor for a homeassistant action node, under either registered id. */
const _HA_NODE_RE = /^(\s*(?:-\s+)?)homeassistant\.(service|action):(.*)$/;

/** A ``|`` / ``>`` block-scalar header, chomping/indent indicators included. */
const _SCALAR_HEADER_RE = /[|>][+-]?\d*\s*$/;

/**
 * Whether the buffer contains any legacy renamed-key spelling the
 * canonicalizer would rewrite. Single-entry memo, same shape as
 * ``parseYamlAutomations``.
 */
export function hasLegacyAutomationSpellings(yaml: string): boolean {
  if (_legacyKey === yaml && _legacyValue !== undefined) return _legacyValue;
  const result = _hasLegacyAutomationSpellings(yaml);
  _legacyKey = yaml;
  _legacyValue = result;
  return result;
}

let _legacyKey: string | undefined;
let _legacyValue: boolean | undefined;

function _hasLegacyAutomationSpellings(yaml: string): boolean {
  const lines = yaml.split("\n");
  const apiBlock = _findTopLevelBlock(lines, "api");
  if (apiBlock) {
    if (
      _findChildBlock(
        lines,
        apiBlock.fromLine,
        apiBlock.toLine,
        API_ACTIONS_BLOCK_KEYS[1]
      )
    ) {
      return true;
    }
    const actions = _findChildBlock(
      lines,
      apiBlock.fromLine,
      apiBlock.toLine,
      API_ACTIONS_BLOCK_KEYS[0]
    );
    if (actions) {
      for (const item of _enumerateListItems(lines, actions.fromLine, actions.toLine)) {
        // Both discriminators present is the collision the
        // canonicalizer skips — don't nudge for it.
        if (
          _readKeyOnLine(lines, item.fromLine, "service") &&
          !_readKeyOnLine(lines, item.fromLine, "action")
        ) {
          return true;
        }
      }
    }
  }
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

/** Depth-1 keys of the outer flow mapping only — a nested ``data:``
 *  payload key never counts, in either direction. */
function _flowHasLegacyField(rest: string): boolean {
  const names: string[] = [];
  let depth = 0;
  let expectingKey = false;
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
        if (rest.slice(end).trimStart().startsWith(":")) names.push(name[0]);
        i = end - 1;
      }
      expectingKey = false;
    }
  }
  return names.includes("service") && !names.includes("action");
}

/** The legacy field at exactly the node's child indent, with no
 *  canonical sibling there (the canonicalizer's collision skip). */
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
    if (/^ *action\s*:/.test(body)) return false;
    if (/^ *service\s*:/.test(body)) legacy = true;
  }
  return legacy;
}

/** Mark lines inside ``|`` / ``>`` block scalars — never match those. */
function _blockScalarMask(lines: string[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false);
  let scalarIndent: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const content = lines[i];
    if (content.trim() === "") {
      if (scalarIndent !== null) mask[i] = true;
      continue;
    }
    const leading = lineIndent(content);
    if (scalarIndent !== null) {
      if (leading > scalarIndent) {
        mask[i] = true;
        continue;
      }
      scalarIndent = null;
    }
    if (_SCALAR_HEADER_RE.test(content.trimEnd())) scalarIndent = leading;
  }
  return mask;
}
