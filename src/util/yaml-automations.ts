/**
 * Synchronous, regex-based YAML automation parser split out of
 * `yaml-sections.ts` to keep that module under the repo's file-size cap.
 * Re-exported from `./yaml-sections.js` so existing call sites are
 * unaffected; import from there or from here directly.
 */

import {
  instanceComponentId,
  listItemChildIndent,
  parseYamlTopLevelSections,
  smallestContainingSection,
  type YamlSection,
} from "./yaml-sections-core.js";

/**
 * A component action-list field (``open_action:`` …): group 1 the
 * indent, group 2 the key. A naming heuristic — the backend
 * (``ConfigEntryType.TRIGGER``) is the authority; this keystroke-time
 * fallback can't see the schema, so a non-trigger ``*_action`` field
 * would surface a spurious row here until backend parse corrects it.
 */
const _COMPONENT_ACTION_FIELD_RE = /^(\s+)([a-z0-9_]+_action):/;

/**
 * Synchronous fallback parser for automation sections. The navigator
 * needs to paint instantly on every keystroke, so we can't wait for
 * the backend's ``automations/parse`` round-trip; this regex-based
 * pass detects:
 *
 * - Inline ``on_*:`` handlers nested inside component instances
 *   (``component_on`` automations).
 * - Device-level ``on_*:`` handlers directly under ``esphome:``
 *   (``device_on`` automations).
 * - List items under top-level ``script:`` and ``interval:`` blocks
 *   (``script`` and ``interval`` automations).
 * - ``*_action`` config fields on a component instance
 *   (``component_action`` automations — cover ``open_action`` …).
 *
 * Emits stable machine-readable keys
 * (``automation:component_on:<id>:on_press`` etc.) plus a separate
 * ``displayLabel`` for the navigator UI. Section routing reads
 * ``key`` (stable identifier the page can match against a
 * ``ParsedAutomation.location``); the navigator displays
 * ``displayLabel``.
 *
 * The backend's ``automations/parse`` is the canonical source — this
 * fallback only sees what the regex catches, but it's load-bearing
 * for keystroke-time UI responsiveness.
 */
export function parseYamlAutomations(yaml: string): YamlSection[] {
  const lines = yaml.split("\n");
  // Memoised on `yaml`, so resolving an id-less host's positional id is
  // free when the caller already parsed sections this render.
  const sections = parseYamlTopLevelSections(yaml);
  const automations: YamlSection[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(\s+)(on_[a-zA-Z_]+):/);
    if (!match) continue;

    const indent = match[1].length;
    const eventName = match[2];
    const fromLine = i + 1; // 1-indexed CM line
    const toLine = _findBlockEnd(lines, i, indent);

    // The enclosing section: a list-item instance, a flat singleton, or
    // the ``esphome:`` block (device-level, handled next).
    const host = smallestContainingSection(sections, fromLine);

    if (host && host.parentKey === undefined && host.key === "esphome") {
      automations.push({
        key: `automation:device_on:${eventName}`,
        // ``displayLabel`` is the legacy "Esphome → on_boot" label;
        // the navigator now prefers catalog-resolved labels but
        // keeps ``displayLabel`` as a graceful fallback for
        // pre-catalog renders.
        displayLabel: `esphome → ${eventName}`,
        fromLine,
        toLine,
        parentKey: "esphome",
        eventKey: eventName,
      });
      continue;
    }

    // Only a direct ``on_*`` child scopes to the host; a deeper handler
    // (``sensor[i].temperature.on_value``) isn't addressable → ``unscoped``.
    let componentId: string | null = null;
    if (host && indent === listItemChildIndent(lines[host.fromLine - 1] ?? "")) {
      componentId = instanceComponentId(sections, host);
    }
    if (host && componentId) {
      const labelHead = host.name || componentId;
      const base = {
        id: componentId,
        name: host.name ?? undefined,
        // Domain (``key`` for a flat singleton) — the catalog is keyed
        // ``<domain>.<event>``, so this resolves the trigger name.
        parentKey: host.parentKey ?? host.key,
        eventKey: eventName,
      };
      // List-shaped trigger (``time.on_time``): one row per cron entry,
      // keyed with its index so each matches the backend's per-entry
      // ``ParsedAutomation`` location. Anything else is one row.
      const entries = _listTriggerEntries(lines, fromLine, toLine);
      if (entries) {
        entries.forEach((entry, idx) => {
          automations.push({
            ...base,
            key: `automation:component_on:${componentId}:${eventName}:${idx}`,
            displayLabel: `${labelHead} → ${eventName} #${idx + 1}`,
            fromLine: entry.fromLine,
            toLine: entry.toLine,
          });
        });
      } else {
        automations.push({
          ...base,
          key: `automation:component_on:${componentId}:${eventName}`,
          displayLabel: `${labelHead} → ${eventName}`,
          fromLine,
          toLine,
        });
      }
      continue;
    }

    // No addressable host (a flat non-esphome block like ``wifi:``, or
    // no resolvable enclosing block) — keep the event as the bare
    // display label and emit a non-namespaced key so it doesn't
    // collide with a properly-resolved automation later.
    automations.push({
      key: `automation:unscoped:${eventName}:${fromLine}`,
      displayLabel: eventName,
      fromLine,
      toLine,
      eventKey: eventName,
    });
  }

  // Component action-list config fields (``open_action:`` …). These are
  // ``type: trigger`` config fields whose value is a bare action list —
  // editable as trigger-less automations, parallel to the inline ``on_*``
  // pass above. Matched by the ``*_action`` suffix and gated to a direct
  // child of a component instance, so an ``on_*`` key (different suffix)
  // and a ``*_action`` nested inside another action body (deeper indent,
  // edited within that automation's tree) are both excluded.
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(_COMPONENT_ACTION_FIELD_RE);
    if (!match) continue;
    const indent = match[1].length;
    const field = match[2];
    // An ``on_*`` key is a trigger, already emitted by the loop above;
    // skip it here so an ``on_…_action`` name can't be counted twice.
    if (field.startsWith("on_")) continue;
    const fromLine = i + 1;
    const host = smallestContainingSection(sections, fromLine);
    if (!host || indent !== listItemChildIndent(lines[host.fromLine - 1] ?? "")) continue;
    const componentId = instanceComponentId(sections, host);
    if (!componentId) continue;
    const labelHead = host.name || componentId;
    automations.push({
      key: `automation:component_action:${componentId}:${field}`,
      displayLabel: `${labelHead} → ${field}`,
      fromLine,
      toLine: _findBlockEnd(lines, i, indent),
      id: componentId,
      parentKey: host.parentKey ?? host.key,
      actionField: field,
    });
  }

  // Top-level ``script:`` / ``interval:`` list items. These don't
  // carry an ``on_*:`` key — the block kind is implied by the
  // location's discriminator.
  for (const top of ["script", "interval"] as const) {
    const block = _findTopLevelBlock(lines, top);
    if (!block) continue;
    const items = _enumerateListItems(lines, block.fromLine, block.toLine);
    items.forEach((item, idx) => {
      const itemId = top === "script" ? _readKeyOnLine(lines, item.fromLine, "id") : null;
      const key =
        top === "script" && itemId
          ? `automation:script:${itemId}`
          : `automation:interval:${idx}`;
      const display =
        top === "script" && itemId ? `script: ${itemId}` : `interval #${idx + 1}`;
      const meta: Record<string, string> = {};
      if (top === "interval") {
        // ``interval: 60s`` lives directly on the list item — pull
        // it so the navigator can render "Every 60s" instead of
        // a generic "interval #N". Optional; we fall back to the
        // index when the field is missing or unparseable.
        const every = _readKeyOnLine(lines, item.fromLine, "interval");
        if (every) meta.every = every;
      }
      automations.push({
        key,
        displayLabel: display,
        fromLine: item.fromLine,
        toLine: item.toLine,
        id: top === "script" && itemId ? itemId : undefined,
        parentKey: top,
        meta: Object.keys(meta).length > 0 ? meta : undefined,
      });
    });
  }

  // ``api.actions:`` list items — Home Assistant-callable actions
  // nested under the top-level ``api:`` block. Same callable shape
  // as ``script:`` (named entry, no trigger key) but one level
  // deeper in the YAML tree. Each item's ``action:`` (or legacy
  // ``service:``) value is the stable discriminator.
  const apiBlock = _findTopLevelBlock(lines, "api");
  if (apiBlock) {
    const actionsBlock = _findChildBlock(
      lines,
      apiBlock.fromLine,
      apiBlock.toLine,
      "actions"
    );
    if (actionsBlock) {
      const items = _enumerateListItems(
        lines,
        actionsBlock.fromLine,
        actionsBlock.toLine
      );
      for (const item of items) {
        const actionName =
          _readKeyOnLine(lines, item.fromLine, "action") ??
          _readKeyOnLine(lines, item.fromLine, "service");
        if (!actionName) continue;
        automations.push({
          key: `automation:api_action:${actionName}`,
          displayLabel: `API: ${actionName}`,
          fromLine: item.fromLine,
          toLine: item.toLine,
          id: actionName,
          parentKey: "api",
        });
      }
    }
  }

  return automations;
}

/** First non-empty line at indent ≤ ``indent`` after ``startIdx``,
 *  or end-of-file. */
function _findBlockEnd(lines: string[], startIdx: number, indent: number): number {
  for (let j = startIdx + 1; j < lines.length; j++) {
    if (lines[j].trim() === "") continue;
    const lineIndent = (lines[j].match(/^(\s*)/) ?? ["", ""])[1].length;
    if (lineIndent <= indent) return j;
  }
  return lines.length;
}

/** Top-level key block (``script:`` / ``interval:``) with its
 *  inclusive 1-indexed line range, or ``null`` when the key is
 *  absent. */
function _findTopLevelBlock(
  lines: string[],
  key: string
): { fromLine: number; toLine: number } | null {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(new RegExp(`^${key}\\s*:`));
    if (!m) continue;
    return { fromLine: i + 1, toLine: _findBlockEnd(lines, i, 0) };
  }
  return null;
}

/** Find a nested key directly under a parent block (e.g.
 *  ``actions:`` inside ``api:``). Returns the matched key's
 *  inclusive 1-indexed line range. */
function _findChildBlock(
  lines: string[],
  parentFromLine: number,
  parentToLine: number,
  childKey: string
): { fromLine: number; toLine: number } | null {
  // Locate the parent block's child indent by reading the first
  // non-blank child line and capturing its leading whitespace.
  let childIndent: number | null = null;
  for (let i = parentFromLine; i < parentToLine && i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const leading = (line.match(/^(\s+)/) ?? ["", ""])[1].length;
    if (leading > 0) {
      childIndent = leading;
      break;
    }
  }
  if (childIndent === null) return null;
  const pattern = new RegExp(`^\\s{${childIndent}}${childKey}\\s*:`);
  for (let i = parentFromLine; i < parentToLine && i < lines.length; i++) {
    if (!pattern.test(lines[i])) continue;
    return { fromLine: i + 1, toLine: _findBlockEnd(lines, i, childIndent) };
  }
  return null;
}

/** List items (``- key: value`` ...) directly inside a top-level
 *  block. Nested list markers (the ``- logger.log`` inside a
 *  ``then:`` clause) are deeper and skipped by pinning to the
 *  block's first-row dash indent. */
function _enumerateListItems(
  lines: string[],
  blockFromLine: number,
  blockToLine: number
): Array<{ fromLine: number; toLine: number }> {
  const out: Array<{ fromLine: number; toLine: number }> = [];
  let topIndent: number | null = null;
  let inItem: { fromLine: number } | null = null;
  for (let i = blockFromLine; i < blockToLine && i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const dash = line.match(/^(\s*)-\s/);
    if (!dash) continue;
    const indent = dash[1].length;
    if (topIndent === null) topIndent = indent;
    // Skip dashes deeper than the block's first row — those are
    // nested action lists inside ``then:`` clauses, not block-level
    // items.
    if (indent > topIndent) continue;
    if (inItem) out.push({ fromLine: inItem.fromLine, toLine: i });
    inItem = { fromLine: i + 1 };
  }
  if (inItem) out.push({ fromLine: inItem.fromLine, toLine: blockToLine });
  return out;
}

/** Keys that mark a ``time.on_time`` list entry — ``then:`` plus the
 *  cron fields. Used to tell a list-shaped trigger (split one row per
 *  entry) from a bare action list (one row for the whole handler). */
const _TRIGGER_ENTRY_KEYS =
  "then|seconds|minutes|hours|days_of_week|days_of_month|months|at|cron";
/** A trigger-entry key at the start of a line; group 1 captures its indent. */
const _TRIGGER_ENTRY_KEY_RE = new RegExp(`^(\\s*)(?:${_TRIGGER_ENTRY_KEYS})\\s*:`);
/** The same key sitting inline right after a list dash (``- seconds: 0``). */
const _DASH_TRIGGER_ENTRY_KEY_RE = new RegExp(
  `^\\s*-\\s+(?:${_TRIGGER_ENTRY_KEYS})\\s*:`
);

/**
 * When an ``on_*:`` body is a YAML list of trigger entries (the
 * ``time.on_time`` shape — each item carries its own cron params and a
 * ``then:``), return one ``{fromLine, toLine}`` per entry; otherwise
 * ``null``. A bare action list (``on_press: - switch.toggle: ...``) or
 * the single-mapping form returns ``null`` so it stays one automation,
 * matching the backend's list-form discriminator and its un-indexed
 * ``component_on`` location.
 */
function _listTriggerEntries(
  lines: string[],
  keyFromLine: number,
  blockToLine: number
): Array<{ fromLine: number; toLine: number }> | null {
  const items = _enumerateListItems(lines, keyFromLine, blockToLine);
  if (items.length === 0) return null;
  return items.every((item) => _isTriggerEntry(lines, item)) ? items : null;
}

/** True when a list item carries ``then:`` or a cron key at its own
 *  content indent. Pinning to the item's indent keeps a nested
 *  ``then:`` under an ``if`` action (a bare action list) from counting. */
function _isTriggerEntry(
  lines: string[],
  item: { fromLine: number; toLine: number }
): boolean {
  const dashLine = lines[item.fromLine - 1] ?? "";
  // The first key can sit inline on the dash: ``- seconds: 0``.
  if (_DASH_TRIGGER_ENTRY_KEY_RE.test(dashLine)) return true;
  // Otherwise a sibling key at the item's own content indent — the column
  // of the first key after ``- ``, derived (not assumed ``+2``) so an
  // extra-space dash doesn't throw it off. A deeper match — a ``then:``
  // nested under an ``if`` action — is not the entry's own key.
  const contentIndent = listItemChildIndent(dashLine);
  for (let i = item.fromLine; i < item.toLine && i < lines.length; i++) {
    const m = lines[i].match(_TRIGGER_ENTRY_KEY_RE);
    if (m && m[1].length === contentIndent) return true;
  }
  return false;
}

/** Leading-whitespace width of a ``- `` list-item dash on *line*
 *  (0 when the line isn't a dash item). */
function _dashIndent(line: string): number {
  return line.match(/^(\s*)-/)?.[1].length ?? 0;
}

/** Read a leading ``key: value`` line inside a list item — used to
 *  pull the script's ``id:`` for the stable section key. */
function _readKeyOnLine(lines: string[], fromLine: number, key: string): string | null {
  const target = lines[fromLine - 1];
  // ``<key>: value`` with the value's quotes peeled — shared between the
  // dash-line form (``- id: my_alarm``) and the indented sibling form.
  const value = `${key}:\\s*["']?([^"'\\s]+)["']?`;
  const m = target.match(new RegExp(`^\\s*-\\s*${value}`));
  if (m) return m[1];
  const dashIndent = _dashIndent(target);
  const siblingRe = new RegExp(`^\\s+${value}`);
  for (let i = fromLine; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const lineIndent = (line.match(/^(\s*)/) ?? ["", ""])[1].length;
    if (lineIndent <= dashIndent) break;
    const kv = line.match(siblingRe);
    if (kv) return kv[1];
  }
  return null;
}
