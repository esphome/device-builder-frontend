/**
 * Schema-driven YAML autocompletion for the ESPHome editor.
 *
 * Backed by the dashboard's existing `components/get_components` and
 * `components/get_component` APIs (the backend has no completion endpoint
 * of its own — completion is computed client-side from the catalog).
 *
 * Completions surface in three positions:
 *
 * 1. **Top-level keys (column 0)** — every component ID in the catalog,
 *    typed `class`, with the category as the secondary `detail` text.
 * 2. **Nested keys** — when the cursor is indented under a known component
 *    block (e.g. `wifi:` then 2 spaces), show that component's
 *    `config_entries[].key` typed `property`, with the field's label and
 *    description as `detail`/`info`.
 * 3. **Values** — for the entry currently being assigned (`key: |`):
 *    - boolean entries → `true` / `false`
 *    - select entries  → the configured options
 *    - `platform:`     → component IDs whose category matches the parent
 *      block (e.g. inside `sensor:` we suggest sensor platforms).
 */
import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import {
  ConfigEntryType,
  type ComponentCatalogEntry,
  type ConfigEntry,
} from "../api/types.js";
import { fetchComponent } from "./component-name-cache.js";
import { ESPHOME_YAML_INDENT } from "./esphome-yaml-lang.js";
import {
  getActions,
  getTriggerKeys,
  type SchemaAction,
} from "./esphome-schema.js";
import {
  collectTopLevelKeys,
  isUnderThenItem,
  resolveBundleContext,
} from "./yaml-ast.js";
import {
  findParentKey,
  findTopLevelBlock,
  RE_INLINE_COMMENT_BOUNDARY,
  readPlatformSibling,
} from "./yaml-line-walker.js";

// ``validFor`` regex constants — consumed by CodeMirror to decide
// whether cached completion options stay valid as the user types.
const RE_KEY = /^[A-Za-z0-9_]*$/;
// Cursor-position matchers. ``plain`` covers ordinary nested-key
// editing (``  partial``); ``list`` covers list-item position
// (``  - partial``) — the entry point for action-registry
// completion inside ``then:``. The list form accepts ``.`` in
// the partial because actions are dotted (``logger.log``).
const RE_KEY_POSITION_PLAIN = /^(\s*)([A-Za-z0-9_]*)$/;
const RE_KEY_POSITION_LIST = /^(\s*)-\s+([A-Za-z0-9_.]*)$/;

interface KeyPosition {
  leading: string;
  partial: string;
  /** True when the user typed (or is starting) a list-item dash
   *  before the partial. Drives action-registry vs. plain-key
   *  completion paths. */
  isListItem: boolean;
}

/**
 * Match the text before the cursor against the two key-position
 * shapes and return the canonicalised pieces, or ``null`` if the
 * cursor isn't in a key-position at all (e.g. mid-value or
 * inside a comment). One callsite, one return shape — keeps the
 * completion source readable.
 */
export function matchKeyPosition(before: string): KeyPosition | null {
  const plain = before.match(RE_KEY_POSITION_PLAIN);
  if (plain) return { leading: plain[1], partial: plain[2], isListItem: false };
  const list = before.match(RE_KEY_POSITION_LIST);
  if (list) return { leading: list[1], partial: list[2], isListItem: true };
  return null;
}

interface ValuePosition {
  leading: string;
  key: string;
  partial: string;
}

// Cursor is to the right of ``key:`` on the current line. Accepts
// both plain (``  key: partial``) and list-item header
// (``  - key: partial``) shapes — the dash form is the entry
// point for ``- platform: <value>`` completion under domain
// blocks like ``binary_sensor:``.
const RE_VALUE_POSITION = /^(\s*)(?:-\s+)?([A-Za-z0-9_]+)\s*:\s*(\S*)$/;
// Leading-whitespace counter — used when computing indents and
// list-item lead text for the trigger / action apply snippets.
// (``yaml-line-walker.ts`` carries the line-shape regexes used
// by the multi-line walkers; this one only operates on the
// current cursor line.)
const RE_LEADING_WHITESPACE = /^( *)/;

/**
 * Match the text before the cursor against the value-position
 * shape (cursor is past a ``key:``). Returns ``null`` when the
 * cursor is in a key-position or mid-line. ``leading`` excludes
 * the optional ``- `` list-item dash so callers comparing it to
 * other indents (e.g. ``findTopLevelBlock``) don't need to
 * special-case the dash column.
 */
export function matchValuePosition(before: string): ValuePosition | null {
  const m = before.match(RE_VALUE_POSITION);
  if (!m) return null;
  return { leading: m[1], key: m[2], partial: m[3] };
}
// Boolean-value typing — only ``true`` / ``false`` matter, so any
// further character drops the popup.
const RE_BOOLEAN_VALUE = /^[A-Za-z]*$/;
// Enum-value characters: digits / letters / dot / slash / dash so
// ``8N1``, ``Noise_NNpsk0_25519_…``, ``UNKNOWN-state``, dotted
// platform names all keep typing.
const RE_ENUM_VALUE = /^[A-Za-z0-9_./-]*$/;
// Action-registry keys are dotted (``logger.log``, ``light.turn_on``)
// — the regex must accept ``.`` or CodeMirror discards the result
// the moment the user types past the dot.
const RE_KEY_OR_ACTION = /^[A-Za-z0-9_.]*$/;

interface CatalogIndex {
  /** Loaded list of components — used for top-level keys. */
  components: ComponentCatalogEntry[];
  /** id → component for direct lookups. */
  byId: Map<string, ComponentCatalogEntry>;
  /** category → components in that category (for `platform:` value lookups). */
  byCategory: Map<string, ComponentCatalogEntry[]>;
}

let catalogPromise: Promise<CatalogIndex> | null = null;

/**
 * Load the component catalog once per session. The list is small enough
 * (~1k entries) to keep entirely in memory; caching avoids re-fetching
 * on every keystroke.
 */
function loadCatalog(api: ESPHomeAPI): Promise<CatalogIndex> {
  if (catalogPromise) return catalogPromise;
  catalogPromise = (async () => {
    const res = await api.getComponents({ limit: 2000 });
    const byId = new Map<string, ComponentCatalogEntry>();
    const byCategory = new Map<string, ComponentCatalogEntry[]>();
    for (const c of res.components) {
      byId.set(c.id, c);
      const list = byCategory.get(c.category) ?? [];
      list.push(c);
      byCategory.set(c.category, list);
    }
    return { components: res.components, byId, byCategory };
  })().catch((err) => {
    console.debug("[yaml-completion] failed to load catalog:", err);
    catalogPromise = null;
    return { components: [], byId: new Map(), byCategory: new Map() };
  });
  return catalogPromise;
}

// ─── Completion building blocks ──────────────────────────────────────

/**
 * Render a small DOM popover for a config entry — used as the
 * `info` callback so users get the field's description on hover.
 */
function buildEntryInfo(entry: ConfigEntry): () => HTMLElement | null {
  return () => {
    if (!entry.description && !entry.default_value && !entry.range) return null;
    const dom = document.createElement("div");
    dom.className = "cm-esphome-info";
    if (entry.description) {
      const p = document.createElement("p");
      p.textContent = entry.description;
      dom.appendChild(p);
    }
    if (entry.default_value !== null && entry.default_value !== undefined) {
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

function entryToCompletion(entry: ConfigEntry): Completion {
  const detailParts: string[] = [];
  if (entry.label && entry.label !== entry.key) detailParts.push(entry.label);
  detailParts.push(entry.required ? "required" : entry.type);
  return {
    label: entry.key,
    apply: `${entry.key}: `,
    type: iconType(entry.type),
    detail: detailParts.join(" · "),
    info: buildEntryInfo(entry),
    boost: entry.required ? 5 : entry.advanced ? -3 : 0,
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

export function buildTopLevelCompletions(catalog: CatalogIndex): Completion[] {
  const cached = topLevelMemo.get(catalog);
  if (cached) return cached;
  const out: Completion[] = [];
  const seen = new Set<string>();
  // Collect domain umbrellas from two sources, then dedupe via
  // ``seen`` — both the entry's ``category`` AND the dotted-id
  // prefix (``ota.esphome`` → ``ota``). Belt and braces:
  //   - ``category`` is the canonical signal but some umbrellas
  //     (e.g. ``ota``, ``update``) carry no standalone catalog
  //     entry, only platform variants.
  //   - The id prefix catches cases where the category enum
  //     hasn't been updated to mirror a new platform domain.
  const domains = new Set<string>();
  for (const c of catalog.components) {
    if (!c.id.includes(".")) continue;
    domains.add(c.category);
    domains.add(c.id.slice(0, c.id.indexOf(".")));
  }
  for (const domain of domains) {
    if (seen.has(domain)) continue;
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

export function platformValueCompletion(
  c: ComponentCatalogEntry,
): Completion {
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
  insert: string,
): void {
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
  });
}

function triggerToCompletion(t: { key: string; docs?: string }): Completion {
  return {
    label: t.key,
    apply: (view, _completion, from, to) => {
      const line = view.state.doc.lineAt(from);
      const lead = line.text.match(RE_LEADING_WHITESPACE)?.[1] ?? "";
      applyInsertion(
        view,
        from,
        to,
        `${t.key}:\n${lead}${ESPHOME_YAML_INDENT}then:\n${lead}${ESPHOME_YAML_INDENT}${ESPHOME_YAML_INDENT}- `,
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
function actionToCompletion(a: SchemaAction): Completion {
  return {
    label: a.key,
    apply: (view, _completion, from, to) => {
      const line = view.state.doc.lineAt(from);
      const before = line.text.slice(0, from - line.from);
      // ``  - `` already present → just append ``key: ``.
      const hasListDash = /^\s*-\s+$/.test(before);
      applyInsertion(
        view,
        from,
        to,
        hasListDash ? `${a.key}: ` : `- ${a.key}: `,
      );
    },
    type: "function",
    detail: "action",
    info: a.docs ?? undefined,
  };
}

/**
 * Map a YAML parent block (``esphome``, ``binary_sensor`` plus a
 * ``platform: gpio`` sibling, …) to the schema-bundle filename and
 * the component key inside that bundle.
 *
 * The schema host's bundle layout is *implementation-keyed*, not
 * domain-keyed:
 *   - ``binary_sensor.json`` carries only ``binary_sensor`` (the
 *     domain — its shared ``_BINARY_SENSOR_SCHEMA`` plus the
 *     condition / filter registries).
 *   - ``gpio.json`` carries the per-domain implementations:
 *     ``gpio.binary_sensor``, ``gpio.switch``, ``gpio.output``…
 *
 * So the correct lookup for ``binary_sensor: - platform: gpio``
 * is bundle ``gpio``, component ``gpio.binary_sensor``. Domain-
 * shared triggers (``on_press``, ``on_release``, …) live inside
 * the ``_BINARY_SENSOR_SCHEMA`` referenced by the platform's
 * ``extends`` chain — ``getTriggerKeys`` follows that chain.
 */
function bundleFor(
  topLevelKey: string,
  platformValue: string | null,
): { bundle: string; componentKey: string } {
  return platformValue
    ? {
        bundle: platformValue,
        componentKey: `${platformValue}.${topLevelKey}`,
      }
    : { bundle: topLevelKey, componentKey: topLevelKey };
}

// ─── Lookups ─────────────────────────────────────────────────────────

/**
 * Resolve the config entries available *under* a parent key. Handles the
 * `sensor: - platform: dht` case: when the parent is a category-style block
 * (sensor/binary_sensor/switch/...) and the current item declares a
 * `platform: <id>`, merge the platform component's config entries with
 * any matching sub_entries from the parent.
 *
 * The catalog keys per-platform implementations as ``<domain>.<stem>``
 * (e.g. ``binary_sensor.template``). When the indent walker hands us
 * a literal ``platform`` key (which is what ``- platform: template``
 * looks like to a regex), we'd otherwise fail to find any
 * config_entries for the form fields the user is actually typing.
 * Recognise that case and fall back to the dotted lookup using the
 * top-level domain — covered by the AST-supplied ``topLevelKey``
 * passed alongside the regex-derived ``parentKey``.
 */
export async function resolveAvailableEntries(
  api: ESPHomeAPI,
  catalog: CatalogIndex,
  parentKey: string,
  platformValue: string | null,
  topLevelKey: string | null,
): Promise<ConfigEntry[]> {
  // Special case: cursor is nested under a list-item header
  // (``- platform: template`` → parentKey="platform"). The form
  // fields the user wants live on the dotted catalog id
  // ``<domain>.<platformValue>`` (e.g. ``binary_sensor.template``).
  // Short-circuit either way — even on a miss, falling through
  // would call ``fetchComponent(api, "platform")`` which 404s
  // and poisons the session-scoped cache for the lifetime of
  // the page (unlikely to matter today, but the failure mode
  // would be silent if a real ``platform`` component ever
  // shipped).
  if (parentKey === "platform") {
    if (!topLevelKey || !platformValue) return [];
    const dotted = catalog.byId.get(`${topLevelKey}.${platformValue}`);
    return dotted ? dotted.config_entries : [];
  }
  const directHit = catalog.byId.get(parentKey);
  if (directHit) {
    // We have a top-level component directly. If it categorizes platforms
    // (i.e. its sub_entries describe a platform-style mapping) and a
    // platform value is set, merge platform fields in.
    if (platformValue) {
      const platformComp = catalog.byId.get(platformValue);
      if (platformComp) {
        return [...directHit.config_entries, ...platformComp.config_entries];
      }
      // Try the dotted lookup — the catalog keys per-platform
      // entries as ``<domain>.<stem>``.
      if (topLevelKey) {
        const dotted = catalog.byId.get(`${topLevelKey}.${platformValue}`);
        if (dotted) {
          return [...directHit.config_entries, ...dotted.config_entries];
        }
      }
    }
    return directHit.config_entries;
  }
  // No direct hit — try fetching the component (handles aliases the
  // catalog list call doesn't return). Routes through the session-
  // scoped component cache so the same parent on every keystroke
  // doesn't re-issue the backend round-trip. Tolerate failures
  // silently.
  try {
    const comp = await fetchComponent(api, parentKey);
    if (comp) return comp.config_entries;
  } catch {
    /* ignore */
  }
  return [];
}

/**
 * Resolve the cursor's structural context for completion lookups,
 * preferring the AST when it can answer and falling back to the
 * indent-text walkers otherwise.
 *
 * The AST handles list-item indent quirks the regex walkers miss
 * — specifically, ``readPlatformSibling`` breaks at the dash
 * column and never sees a ``platform:`` sibling sitting at the
 * list-item-body indent. The regex walkers stay as the fallback
 * for cases the AST can't answer (e.g. partial input that
 * doesn't parse cleanly).
 */
function resolveCompletionContext(
  state: EditorState,
  pos: number,
  allLines: string[],
  lineIdx: number,
  indent: number,
): {
  platformValue: string | null;
  topLevelKey: string | null;
  bundleCtx: ReturnType<typeof resolveBundleContext>;
} {
  const bundleCtx = resolveBundleContext(state, pos);
  return {
    bundleCtx,
    platformValue:
      bundleCtx?.platformValue ??
      readPlatformSibling(allLines, lineIdx, indent),
    topLevelKey:
      bundleCtx?.topLevelKey ?? findTopLevelBlock(allLines, lineIdx),
  };
}

// ─── The completion source ───────────────────────────────────────────

/**
 * Build the autocompletion source. Returned closure captures `api` so the
 * editor can wire it up once.
 */
export function createYamlCompletionSource(api: ESPHomeAPI) {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const { state, pos } = ctx;
    const lineInfo = state.doc.lineAt(pos);
    const lineText = lineInfo.text;
    const colInLine = pos - lineInfo.from;
    const before = lineText.slice(0, colInLine);

    // Don't fire inside comments.
    const commentStart = before.match(RE_INLINE_COMMENT_BOUNDARY);
    if (commentStart && commentStart.index !== undefined) {
      const idx = commentStart.index + commentStart[0].length - 1;
      if (colInLine > idx) return null;
    }

    const allLines = state.doc.toString().split("\n");

    // ── Value position: `key:` already on this line, cursor after the colon.
    // Value position: cursor is past ``  key: partial`` (plain) or
    // ``  - key: partial`` (list-item header). The dash form is the
    // entry point for ``- platform: <value>`` completion under
    // domain blocks like ``binary_sensor:``.
    const valueMatch = before.match(RE_VALUE_POSITION);
    if (valueMatch) {
      const [, leading, key, partial] = valueMatch;
      const indent = leading.length;
      const valueFrom = pos - partial.length;

      // Trigger only when the user has typed something OR pressed ctrl-space.
      if (!ctx.explicit && partial.length === 0) return null;

      const catalog = await loadCatalog(api);

      // `platform:` value → suggest components whose category matches the
      // parent top-level block (e.g. sensor: → platforms in sensor category).
      if (key === "platform") {
        const block = findTopLevelBlock(allLines, lineInfo.number - 1);
        if (block) {
          const candidates = catalog.byCategory.get(block) ?? [];
          if (candidates.length > 0) {
            return {
              from: valueFrom,
              options: candidates.map(platformValueCompletion),
              validFor: RE_KEY,
            };
          }
        }
      }

      // Resolve the entry being set so we can value-complete against it.
      const parent = findParentKey(allLines, lineInfo.number - 1, indent);
      let entries: ConfigEntry[] = [];
      if (parent) {
        const completionCtx = resolveCompletionContext(
          state,
          pos,
          allLines,
          lineInfo.number - 1,
          indent,
        );
        entries = await resolveAvailableEntries(
          api,
          catalog,
          parent.key,
          completionCtx.platformValue,
          completionCtx.topLevelKey,
        );
      } else {
        // We're in a top-level value (rare — most top-level values are
        // mappings). Bail.
        return null;
      }

      const entry = entries.find((e) => e.key === key);
      if (!entry) return null;

      if (entry.type === ConfigEntryType.BOOLEAN) {
        return {
          from: valueFrom,
          options: [
            { label: "true", type: "constant" },
            { label: "false", type: "constant" },
          ],
          validFor: RE_BOOLEAN_VALUE,
        };
      }
      if (entry.options && entry.options.length > 0) {
        return {
          from: valueFrom,
          options: entry.options.map((o) => ({
            label: o.value,
            type: "enum",
            detail: o.label !== o.value ? o.label : undefined,
          })),
          validFor: RE_ENUM_VALUE,
        };
      }
      return null;
    }

    // ── Key position: handles plain (``  partial``) and list-item
    // (``  - partial``) shapes. The dash form is the entry point
    // for action-registry suggestions inside automation bodies
    // (``then: - <here>``); without matching it we'd never fire
    // the completion in that position.
    const kp = matchKeyPosition(before);
    if (!kp) return null;
    const { leading, partial, isListItem } = kp;
    const indent = leading.length;
    const keyFrom = pos - partial.length;

    if (!ctx.explicit && partial.length === 0) return null;

    const catalog = await loadCatalog(api);

    // Top-level (column 0) → platform-domain umbrellas (extracted
    // from each catalog entry's category) plus standalone
    // components (catalog entries whose id has no dot). See
    // ``buildTopLevelCompletions`` for the rationale.
    if (indent === 0) {
      return {
        from: keyFrom,
        options: buildTopLevelCompletions(catalog),
        validFor: RE_KEY,
      };
    }

    // Nested → config_entries of the parent block (or platform-merged).
    const parent = findParentKey(allLines, lineInfo.number - 1, indent);
    if (!parent) return null;

    const ctx2 = resolveCompletionContext(
      state,
      pos,
      allLines,
      lineInfo.number - 1,
      indent,
    );
    const { bundleCtx, platformValue } = ctx2;
    // Action-registry only fires at the list-item position under
    // a ``then:`` block. AST-based: walk up the tree looking for
    // an ``Item`` whose enclosing ``Pair`` has Key=``then``.
    // Mirrors the legacy ``resolveTriggerInner`` →
    // ``addRegistry({registry: "action"})`` shape; replaces the
    // brittle indent-walking heuristic.
    const inAutomation = isListItem && isUnderThenItem(state, pos);
    // Only fetch trigger keys when the partial *could* match one
    // — they all start with ``on_``. Saves a network round-trip
    // (and the failure-mode log on CSP-blocked deployments) on
    // every keystroke that obviously doesn't want a trigger.
    // Explicit ctrl-space requests bypass the prefix gate so
    // power users can still browse.
    const partialCouldBeTrigger =
      ctx.explicit || partial === "" || /^o(n(_[a-z0-9_]*)?)?$/i.test(partial);

    // Skip the entries lookup inside an automation body — the
    // parent walker would resolve ``then`` as the parent key and
    // ``fetchComponent(api, "then")`` would 404 (and cache a
    // useless entry). Action-registry completion is what
    // populates that position; config-vars don't apply.
    const fetchEntries = (): Promise<ConfigEntry[]> =>
      inAutomation
        ? Promise.resolve([])
        : resolveAvailableEntries(
            api,
            catalog,
            parent.key,
            platformValue,
            bundleCtx?.topLevelKey ?? null,
          );

    // Pull the typed schema's ``on_*`` triggers from
    // ``schema.esphome.io`` and stack them on top of the
    // catalog's config-vars. Returns ``[]`` on any failure (CSP /
    // offline / missing bundle), so the catalog completions stay
    // the floor — graceful degradation for when
    // schema.esphome.io isn't reachable.
    const fetchTriggers = async (): Promise<
      { key: string; docs?: string }[]
    > => {
      // Triggers don't apply at action position — even if the
      // user's partial happens to start with ``o`` (e.g.
      // ``output.turn_on``), surfacing ``on_*`` triggers would
      // be misleading and burns a network round-trip.
      if (inAutomation) return [];
      if (!partialCouldBeTrigger) return [];
      if (!bundleCtx) return [];
      const target = bundleFor(bundleCtx.topLevelKey, bundleCtx.platformValue);
      return getTriggerKeys(api, target.bundle, target.componentKey);
    };

    // Aggregate action-registry entries across components in the
    // doc when the cursor is inside a ``then:`` list-item.
    // ``esphome`` is always included as a bundle — that's where
    // the schema host serves the ``core`` actions
    // (``delay`` / ``if`` / ``lambda`` / ``repeat`` / ``while`` /
    // ``wait_until``) under the bundle's ``core`` key. ``core``
    // is always added to the wanted-keys filter so those core
    // actions surface even when the doc only mentions one
    // component.
    const fetchActions = async (): Promise<SchemaAction[]> => {
      if (!inAutomation) return [];
      const tops = collectTopLevelKeys(state);
      const bundles = [...new Set([...tops, "esphome"])];
      return getActions(api, bundles, [...tops, "core"]);
    };

    const [entries, triggers, actions] = await Promise.all([
      fetchEntries(),
      fetchTriggers(),
      fetchActions(),
    ]);
    // Platform-list fallback: when the cursor is at a list-item
    // position (``  - |``) under a key that's a known platform
    // domain (``ota:``, ``binary_sensor:``, ``sensor:``, …), the
    // canonical first key is ``platform:``. The catalog only
    // carries the dotted platform implementations
    // (``ota.esphome``, ``binary_sensor.gpio``, …) so a bare
    // ``platform`` key never appears in ``config_entries``.
    // Surface it as a hardcoded suggestion when we know the
    // parent block is a platform domain — i.e. the catalog has
    // entries with this category.
    const inPlatformList =
      isListItem && catalog.byCategory.has(parent.key);
    const platformKey: Completion[] = inPlatformList
      ? [
          {
            label: "platform",
            apply: "platform: ",
            type: "property",
            detail: "platform domain",
            boost: 5,
          },
        ]
      : [];

    // Trigger-body fallback: when the cursor is nested directly
    // under a key that looks like an ``on_*`` trigger, every
    // ESPHome trigger accepts a ``then:`` body even if the
    // schema declares no explicit config-vars (most don't —
    // ``on_press`` and friends have empty schemas). Surface
    // ``then:`` as a hardcoded suggestion so the user typing
    // ``th`` lands on the right key. Mirrors the legacy
    // editor's "all triggers support then" special case.
    const inTriggerBody =
      !inAutomation && /^on_[a-z0-9_]*$/.test(parent.key);
    const triggerBody: Completion[] = inTriggerBody
      ? [
          {
            label: "then",
            apply: (view, _completion, from, to) => {
              // ``then:`` is at the same indent as the current
              // partial; the action list-item ``-`` lives one
              // indent step deeper. Read the current line's
              // leading whitespace so the snippet stays valid
              // YAML at any nesting depth.
              const line = view.state.doc.lineAt(from);
              const lead =
                line.text.match(RE_LEADING_WHITESPACE)?.[1] ?? "";
              applyInsertion(
                view,
                from,
                to,
                `then:\n${lead}${ESPHOME_YAML_INDENT}- `,
              );
            },
            type: "namespace",
            detail: "trigger body",
            boost: 5,
          },
        ]
      : [];

    if (
      entries.length === 0 &&
      triggers.length === 0 &&
      actions.length === 0 &&
      triggerBody.length === 0 &&
      platformKey.length === 0
    )
      return null;

    const options: Completion[] = [
      ...entries.filter((e) => !e.hidden).map(entryToCompletion),
      ...triggers.map(triggerToCompletion),
      ...actions.map(actionToCompletion),
      ...triggerBody,
      ...platformKey,
    ];

    return {
      from: keyFrom,
      options,
      validFor: RE_KEY_OR_ACTION,
    };
  };
}

