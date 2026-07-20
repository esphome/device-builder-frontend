/**
 * Completion-item builders for the ESPHome YAML autocompletion source.
 *
 * Pure converters from catalog / schema shapes (``ConfigEntry``,
 * ``ComponentCatalogEntry``, ``SchemaConfigVarKey``, ``SchemaAction``,
 * ``SchemaRegistryEntry``) into CodeMirror ``Completion`` objects, plus
 * the ``apply`` helpers that drive the editor insertion + popup re-open.
 *
 * Split out of ``yaml-completion.ts`` to keep that file under the repo's
 * size cap: the completion source (cursor-position matching, provider
 * pipeline) imports these builders; nothing here imports back except the
 * ``CatalogIndex`` *type*, so the value-level dependency is strictly
 * one-directional (this module ← yaml-completion.ts).
 */
import { startCompletion, type Completion } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import type { ComponentCatalogEntry } from "../api/types/components.js";
import { ConfigEntryType, type ConfigEntry } from "../api/types/config-entries.js";
import type {
  SchemaAction,
  SchemaConfigVarKey,
  SchemaRegistryEntry,
} from "./esphome-schema.js";
import { ESPHOME_YAML_INDENT } from "./esphome-yaml-lang.js";
import type { CatalogIndex } from "./yaml-completion-catalog.js";
import { AUTOMATION_KEYS, CORE_KEYS } from "./yaml-sections.js";

// Leading-whitespace counter — used when computing indents and
// list-item lead text for the trigger / action apply snippets.
// (``yaml-line-walker.ts`` carries the line-shape regexes used
// by the multi-line walkers; this one only operates on the
// current cursor line.)
const RE_LEADING_WHITESPACE = /^( *)/;

// ─── Completion building blocks ──────────────────────────────────────

/**
 * Render a small DOM popover for a config entry — used as the
 * `info` callback so users get the field's description on hover.
 */
function buildEntryInfo(entry: ConfigEntry): () => HTMLElement | null {
  return () => {
    const hasDefault = entry.default_value !== null && entry.default_value !== undefined;
    if (!entry.description && !hasDefault && !entry.range) return null;
    const dom = document.createElement("div");
    dom.className = "cm-esphome-info";
    if (entry.description) {
      const p = document.createElement("p");
      p.textContent = entry.description;
      dom.appendChild(p);
    }
    if (hasDefault) {
      const def = document.createElement("div");
      def.className = "cm-esphome-info-meta";
      def.textContent = `Default: ${String(entry.default_value)}`;
      dom.appendChild(def);
    }
    if (entry.range) {
      const range = document.createElement("div");
      range.className = "cm-esphome-info-meta";
      range.textContent = `Range: ${entry.range[0]} – ${entry.range[1]}`;
      dom.appendChild(range);
    }
    return dom;
  };
}

function buildComponentInfo(c: ComponentCatalogEntry): () => HTMLElement | null {
  return () => {
    if (!c.description && !c.category) return null;
    const dom = document.createElement("div");
    dom.className = "cm-esphome-info";
    if (c.description) {
      const p = document.createElement("p");
      p.textContent = c.description;
      dom.appendChild(p);
    }
    const meta = document.createElement("div");
    meta.className = "cm-esphome-info-meta";
    meta.textContent = `Category: ${c.category}`;
    dom.appendChild(meta);
    return dom;
  };
}

/** Map config entry types to CodeMirror's icon types for the gutter icon. */
function iconType(type: ConfigEntryType): string {
  switch (type) {
    case ConfigEntryType.BOOLEAN:
      return "constant";
    case ConfigEntryType.INTEGER:
    case ConfigEntryType.FLOAT:
      return "constant";
    case ConfigEntryType.LAMBDA:
    case ConfigEntryType.JSON:
      return "function";
    case ConfigEntryType.PIN:
    case ConfigEntryType.ID:
    case ConfigEntryType.TRIGGER:
      return "namespace";
    default:
      return "property";
  }
}

export function entryToCompletion(entry: ConfigEntry): Completion {
  const detailParts: string[] = [];
  if (entry.label && entry.label !== entry.key) detailParts.push(entry.label);
  detailParts.push(entry.required ? "required" : entry.type);
  return {
    label: entry.key,
    apply: (view, _completion, from, to) => applyKeyInsertion(view, from, to, entry.key),
    type: iconType(entry.type),
    detail: detailParts.join(" · "),
    info: buildEntryInfo(entry),
    boost: entry.required ? 5 : entry.advanced || entry.hidden ? -3 : 0,
  };
}

function componentToCompletion(c: ComponentCatalogEntry): Completion {
  return {
    label: c.id,
    apply: `${c.id}:\n${ESPHOME_YAML_INDENT}`,
    type: "class",
    detail: c.category,
    info: buildComponentInfo(c),
  };
}

/**
 * Build the top-level YAML keys the user can type at column 0:
 *
 *   - Each unique platform domain (``binary_sensor``, ``sensor``,
 *     ``switch``, …). The catalog represents these only as
 *     dotted ids (``binary_sensor.gpio``, ``sensor.dht``, …) —
 *     the bare domain name comes from the category.
 *   - Each standalone component the catalog carries as a
 *     non-dotted id (``wifi``, ``logger``, ``esphome``, …).
 *
 * The catalog mixes both shapes; this helper splits them so a
 * top-level completion offers ``binary_sensor`` (the YAML key the
 * user actually wants to type) and not ``binary_sensor.apds9960``
 * (a platform value that belongs INSIDE the ``binary_sensor:``
 * block, not at the top level).
 */
/** Per-catalog memo for the top-level completion list. The
 *  catalog is loaded once per session and never mutates; the
 *  helper iterates every entry to derive domain umbrellas plus
 *  standalone components, so caching by ``CatalogIndex`` identity
 *  keeps a column-0 keystroke from re-walking ~1k entries on
 *  every fire. ``WeakMap`` so a stale catalog (e.g. between
 *  hypothetical session resets) gets garbage-collected with its
 *  memo. */
const topLevelMemo = new WeakMap<CatalogIndex, Completion[]>();
const domainsMemo = new WeakMap<CatalogIndex, ReadonlySet<string>>();

/**
 * Platform-domain umbrellas (``switch``, ``sensor``, …), from two
 * sources deduped by the Set — both the entry's ``category`` AND the
 * dotted-id prefix (``ota.esphome`` → ``ota``). Belt and braces:
 * ``category`` is the canonical signal but some umbrellas (e.g. ``ota``,
 * ``update``) carry no standalone catalog entry, only platform variants;
 * the id prefix catches a category enum lagging a new platform domain.
 */
export function platformDomains(catalog: CatalogIndex): ReadonlySet<string> {
  const cached = domainsMemo.get(catalog);
  if (cached) return cached;
  const domains = new Set<string>();
  for (const c of catalog.components) {
    if (!c.id.includes(".")) continue;
    domains.add(c.category);
    domains.add(c.id.slice(0, c.id.indexOf(".")));
  }
  domainsMemo.set(catalog, domains);
  return domains;
}

export function buildTopLevelCompletions(catalog: CatalogIndex): Completion[] {
  const cached = topLevelMemo.get(catalog);
  if (cached) return cached;
  const out: Completion[] = [];
  const seen = new Set<string>();
  for (const domain of platformDomains(catalog)) {
    seen.add(domain);
    out.push({
      label: domain,
      apply: `${domain}:\n${ESPHOME_YAML_INDENT}`,
      type: "class",
      detail: "platform domain",
    });
  }
  // Add standalone (non-dotted) components.
  for (const c of catalog.components) {
    if (c.id.includes(".") || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(componentToCompletion(c));
  }
  topLevelMemo.set(catalog, out);
  return out;
}

const knownKeysMemo = new WeakMap<CatalogIndex, Set<string>>();

/**
 * Every valid top-level key: catalog domains and standalone ids plus the
 * core and automation sections. ``null`` for an empty catalog —
 * ``loadCatalog``'s failure path resolves an empty index, and callers must
 * fail toward "known" rather than classify every component as unknown.
 */
export function knownTopLevelKeys(catalog: CatalogIndex): Set<string> | null {
  if (catalog.components.length === 0) return null;
  const cached = knownKeysMemo.get(catalog);
  if (cached) return cached;
  const keys = new Set<string>([...CORE_KEYS, ...AUTOMATION_KEYS]);
  for (const item of buildTopLevelCompletions(catalog)) keys.add(item.label);
  knownKeysMemo.set(catalog, keys);
  return keys;
}

export function platformValueCompletion(c: ComponentCatalogEntry): Completion {
  // ``c.id`` is the dotted catalog id (``binary_sensor.gpio``);
  // YAML's ``platform:`` value is just the stem (``gpio``).
  // Strip the domain prefix so the inserted text is valid YAML —
  // matches the legacy editor's ``getPlatformNames`` which
  // yielded each entry as the bare component name.
  const stem = c.id.includes(".") ? c.id.slice(c.id.indexOf(".") + 1) : c.id;
  return {
    label: stem,
    type: "enum",
    detail: c.category,
    info: buildComponentInfo(c),
  };
}

/**
 * Render a trigger config-var (``on_boot`` / ``on_press`` / …) as a
 * completion. Mirrors the legacy dashboard's behaviour: the canonical
 * shape of an automation trigger is ``on_*:\n  then:\n    - `` so
 * we apply that snippet directly — saves the user three Tab presses
 * to land at the action position.
 *
 * The trigger key may itself be at any indent (column 0 under
 * ``esphome:`` body, but column 4+ under
 * ``binary_sensor: - platform: gpio:``). ``apply`` is a function so
 * it can read the current line's leading whitespace and emit
 * ``then:`` / ``-`` at the right depth instead of hard-coding two
 * and four spaces. (Copilot-flagged on the fixed-snippet version.)
 */
function applyInsertion(
  view: EditorView,
  from: number,
  to: number,
  insert: string
): void {
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
  });
}

/** Insert ``key: `` and immediately re-open the completion popup
 *  so the user lands at the value position with the next set of
 *  suggestions visible (boolean / enum / schema-bundle fallback)
 *  without having to ctrl-space again. Used by every key-insert
 *  completion (catalog ``entryToCompletion`` and schema-bundle
 *  ``schemaKeyToCompletion``). */
export function applyKeyInsertion(
  view: EditorView,
  from: number,
  to: number,
  key: string
): void {
  applyInsertion(view, from, to, `${key}: `);
  startCompletion(view);
}

/** Insert ``key:\n${lead}${INDENT}- `` for list-of-mapping
 *  config-vars (``filters:``, ``then:``, …). The user lands at
 *  the dash ready to type the first list item; ``startCompletion``
 *  re-opens the popup so the registry / action options surface
 *  immediately. */
export function applyListBlockInsertion(
  view: EditorView,
  from: number,
  to: number,
  key: string
): void {
  const lead = readLineLead(view, from);
  applyInsertion(view, from, to, `${key}:\n${lead}${ESPHOME_YAML_INDENT}- `);
  startCompletion(view);
}

/** Insert a list-item completion's ``key: `` with a leading
 *  dash if the cursor isn't already past one (``  - `` already
 *  on the line). Shared by every list-item-shaped completion
 *  (action registry, filter / condition / effect registries,
 *  …). */
function applyListItemEntry(
  view: EditorView,
  from: number,
  to: number,
  key: string
): void {
  const line = view.state.doc.lineAt(from);
  const before = line.text.slice(0, from - line.from);
  const hasListDash = /^\s*-\s+$/.test(before);
  applyInsertion(view, from, to, hasListDash ? `${key}: ` : `- ${key}: `);
}

/** Read the leading-whitespace prefix of the editor line that
 *  contains *from*. Used by completion ``apply`` callbacks that
 *  need to emit a multi-line snippet whose indent must match the
 *  current line — the snippet's ``then:`` / ``-`` lines live one
 *  indent step deeper than the partial. */
function readLineLead(view: EditorView, from: number): string {
  const line = view.state.doc.lineAt(from);
  return line.text.match(RE_LEADING_WHITESPACE)?.[1] ?? "";
}

/**
 * Render a schema-bundle config-var as a completion. Used as the
 * fallback when the prebuilt catalog has no ``config_entries`` for
 * the current parent (typically platform-merged ids whose schema
 * generation didn't expand the typed/extends chain — e.g.
 * ``sensor.uptime``). Apply text is ``key: `` so the cursor lands
 * at the value position; the schema doesn't tell us whether the
 * value is scalar or block-shaped, so leave the user to type ``\n``
 * manually if they want a block.
 */
export function schemaKeyToCompletion(k: SchemaConfigVarKey): Completion {
  return {
    label: k.key,
    apply: (view, _completion, from, to) =>
      k.isList
        ? applyListBlockInsertion(view, from, to, k.key)
        : applyKeyInsertion(view, from, to, k.key),
    type: "property",
    detail: k.required ? "required" : undefined,
    info: k.docs ?? undefined,
  };
}

export function triggerToCompletion(t: { key: string; docs?: string }): Completion {
  return {
    label: t.key,
    apply: (view, _completion, from, to) => {
      const lead = readLineLead(view, from);
      const inner = lead + ESPHOME_YAML_INDENT;
      applyInsertion(
        view,
        from,
        to,
        `${t.key}:\n${inner}then:\n${inner}${ESPHOME_YAML_INDENT}- `
      );
    },
    type: "namespace",
    detail: "trigger",
    info: t.docs ?? undefined,
    boost: 2,
  };
}

/**
 * Render an action-registry entry (``logger.log`` / ``light.turn_on``
 * / ``delay`` / …) as a completion inside an automation body.
 * Applied as ``- <action>: `` so the user lands at the action's
 * argument position. List-item shape is dynamic: if the current
 * line is already a list item (``  - `` already typed), don't
 * double up the dash.
 */
export function actionToCompletion(a: SchemaAction): Completion {
  return {
    label: a.key,
    apply: (view, _completion, from, to) => applyListItemEntry(view, from, to, a.key),
    type: "function",
    detail: "action",
    info: a.docs ?? undefined,
  };
}

/** Render a schema-registry entry (``calibrate_linear``,
 *  ``clamp``, …) as a list-item completion. ``detail`` is the
 *  registry-key name itself (``filter`` / ``effects``) so the
 *  popup distinguishes filters from actions when both could
 *  apply. */
export function registryToCompletion(
  e: SchemaRegistryEntry,
  registryKey: string
): Completion {
  return {
    label: e.key,
    apply: (view, _completion, from, to) => applyListItemEntry(view, from, to, e.key),
    type: "function",
    detail: registryKey,
    info: e.docs ?? undefined,
  };
}
