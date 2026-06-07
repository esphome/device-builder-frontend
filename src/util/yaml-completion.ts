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
import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { EditorState } from "@codemirror/state";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import type { ComponentCatalogEntry } from "../api/types/components.js";
import { ConfigEntryType, type ConfigEntry } from "../api/types/config-entries.js";
import { fetchComponent } from "./component-name-cache.js";
import { findReferenceCandidates, parseCatalogId } from "./config-entry-yaml-scan.js";
import {
  getActions,
  getConfigVarKeys,
  getConfigVarValueOptions,
  getRegistryEntries,
  getRegistryEntryKeys,
  getTriggerKeys,
  lookupRegistryRef,
  parseRegistryLabel,
} from "./esphome-schema.js";
import {
  collectSubstitutionKeys,
  collectTopLevelKeys,
  isUnderAutomationItem,
  resolveBundleContext,
} from "./yaml-ast.js";
import {
  actionToCompletion,
  applyKeyInsertion,
  applyListBlockInsertion,
  buildTopLevelCompletions,
  entryToCompletion,
  platformValueCompletion,
  registryToCompletion,
  schemaKeyToCompletion,
  triggerToCompletion,
} from "./yaml-completion-items.js";
import {
  findParentKey,
  findTopLevelBlock,
  RE_INLINE_COMMENT_BOUNDARY,
  readPlatformSibling,
} from "./yaml-line-walker.js";

// Re-exported on this module's public surface for consumers that
// import these builders from ``yaml-completion`` directly (the
// top-level-completion tests). Implementations live in the
// extracted ``yaml-completion-items`` module.
export { buildTopLevelCompletions, platformValueCompletion };

// ``validFor`` regex constants — consumed by CodeMirror to decide
// whether cached completion options stay valid as the user types.
const RE_KEY = /^[A-Za-z0-9_]*$/;
/** Trigger-prefix gate for the trigger-keys provider — every
 *  ESPHome trigger starts with ``on_``; partials matching this
 *  shape may yet become a trigger, so it's worth fetching the
 *  schema. Anything else (``platform``, ``name``, ``device_class``,
 *  …) saves the round-trip. Explicit ctrl-space bypasses the
 *  gate so power users can browse. */
const RE_TRIGGER_PREFIX = /^o(n(_[a-z0-9_]*)?)?$/i;
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

export interface CatalogIndex {
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
export function loadCatalog(api: ESPHomeAPI): Promise<CatalogIndex> {
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
export function bundleFor(
  topLevelKey: string,
  platformValue: string | null
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
  topLevelKey: string | null
): Promise<ConfigEntry[]> {
  // The slim ``getComponents`` index carries no ``config_entries``
  // (those hydrate lazily through ``components/get_component_bodies``),
  // so the catalog tells us only *which* ids exist — never their
  // fields. Hydrate the body for an id known to the index; return
  // ``[]`` for unknown ids so we never fetch ``platform`` (or any
  // non-component key) and poison the session cache with a 404.
  // Tolerate fetch failures silently: ``BatchedCache`` rejects on a
  // transport error or a mid-flight ``_clearComponentCache()``, and the
  // completion source isn't wrapped — an unguarded throw here would drop
  // the whole popup instead of degrading to no suggestions.
  const entriesFor = async (id: string): Promise<ConfigEntry[]> => {
    if (!catalog.byId.has(id)) return [];
    try {
      const body = await fetchComponent(api, id);
      return body?.config_entries ?? [];
    } catch {
      return [];
    }
  };

  // Cursor nested under a list-item header (``- platform: template``
  // → parentKey="platform"). The form fields live on the dotted
  // catalog id ``<domain>.<platformValue>`` (``binary_sensor.template``).
  if (parentKey === "platform") {
    if (!topLevelKey || !platformValue) return [];
    return entriesFor(`${topLevelKey}.${platformValue}`);
  }
  if (catalog.byId.has(parentKey)) {
    // Top-level component directly. If a platform value is set, merge
    // the platform implementation's fields in (the catalog keys
    // per-platform entries as ``<domain>.<stem>``). Resolve the merge
    // id up front so both bodies register before the microtask flush
    // and batch into a single ``get_component_bodies`` round trip.
    let mergeId: string | null = null;
    if (platformValue) {
      if (catalog.byId.has(platformValue)) {
        mergeId = platformValue;
      } else if (topLevelKey && catalog.byId.has(`${topLevelKey}.${platformValue}`)) {
        mergeId = `${topLevelKey}.${platformValue}`;
      }
    }
    if (mergeId) {
      const [own, extra] = await Promise.all([
        entriesFor(parentKey),
        entriesFor(mergeId),
      ]);
      return [...own, ...extra];
    }
    return entriesFor(parentKey);
  }
  // No direct hit — try fetching the component (handles aliases the
  // catalog list call doesn't return). Routes through the session-
  // scoped component cache so the same parent on every keystroke
  // doesn't re-issue the backend round-trip. Tolerate failures
  // silently.
  try {
    const comp = await fetchComponent(api, parentKey);
    if (comp) return comp.config_entries ?? [];
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
  lineIdx: number,
  indent: number
): {
  platformValue: string | null;
  topLevelKey: string | null;
  bundleCtx: ReturnType<typeof resolveBundleContext>;
} {
  const bundleCtx = resolveBundleContext(state, pos);
  // When the AST resolves ``bundleCtx`` it has read the cursor's
  // structure end-to-end — including a deliberate
  // ``platformValue: null`` for "cursor not inside a ``- platform:``
  // list-item". Trust that answer and don't fall through to the
  // regex walker (which can otherwise grab an unrelated
  // ``- platform: …`` line elsewhere in the doc and synthesise a
  // bogus context). The regex fallback fires only when the AST
  // is silent (half-typed pair, partial parse). Same rule for
  // ``topLevelKey``.
  if (bundleCtx) {
    return {
      bundleCtx,
      platformValue: bundleCtx.platformValue,
      topLevelKey: bundleCtx.topLevelKey,
    };
  }
  return {
    bundleCtx: null,
    platformValue: readPlatformSibling(state.doc, lineIdx, indent),
    topLevelKey: findTopLevelBlock(state.doc, lineIdx),
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

      // ``key:`` with no partial is a deliberate value position
      // — typing the colon is itself the signal that the user
      // wants a value suggestion (especially for fixed-set enums
      // like ``device_class:``). Fire the completion source so
      // the popup opens automatically without forcing ctrl-space.
      // (User-requested: empty-partial gate was too strict at
      // value position.)

      // Substitution reference: the partial starts with ``${``
      // (and the user hasn't closed the ``}`` yet). Suggest every
      // key declared under the doc's ``substitutions:`` mapping
      // — typing ``${id_pre`` lands ``id_prefix``. Mirrors the
      // legacy editor's ``${…}`` reference completion. Distinct
      // from value-position enum / boolean: a ``${ref}`` can
      // appear in any value, regardless of the entry's type.
      const subRefMatch = /^\$\{([A-Za-z0-9_]*)$/.exec(partial);
      if (subRefMatch) {
        const subs = collectSubstitutionKeys(state);
        if (subs.length > 0) {
          return {
            from: valueFrom,
            options: subs.map((name) => ({
              label: `\${${name}}`,
              apply: `\${${name}}`,
              type: "variable",
              detail: "substitution",
            })),
            // ``\$\{…\}`` partial — keep options valid only while
            // the partial stays in the ``${ident`` shape.
            validFor: /^\$\{[A-Za-z0-9_]*\}?$/,
          };
        }
      }

      const catalog = await loadCatalog(api);

      // `platform:` value → suggest components whose category matches the
      // parent top-level block (e.g. sensor: → platforms in sensor category).
      if (key === "platform") {
        const block = findTopLevelBlock(state.doc, lineInfo.number - 1);
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
      const parent = findParentKey(state.doc, lineInfo.number - 1, indent);
      // We're in a top-level value (rare — most top-level values
      // are mappings). Bail.
      if (!parent) return null;
      const completionCtx = resolveCompletionContext(
        state,
        pos,
        lineInfo.number - 1,
        indent
      );
      const entries = await resolveAvailableEntries(
        api,
        catalog,
        parent.key,
        completionCtx.platformValue,
        completionCtx.topLevelKey
      );
      const entry = entries.find((e) => e.key === key);

      // ID-reference field (``i2c_id:``, ``output:``, …) → suggest the
      // IDs declared in the referenced domain plus any cross-domain
      // providers (``voltage_sampler`` → ADC sensors under ``sensor:``).
      // Mirrors the visual form's ``renderIdReferenceField`` so both
      // editors offer the same candidate set. Declaring ``id:`` fields
      // carry a null ``references_component`` and fall through untouched.
      if (entry?.type === ConfigEntryType.ID && entry.references_component) {
        const domain = entry.references_component;
        const providers = catalog.components
          .filter((c) => c.provides?.includes(domain))
          .map((c) => parseCatalogId(c.id));
        const candidates = findReferenceCandidates(
          state.doc.toString(),
          domain,
          providers
        );
        if (candidates.length > 0) {
          return {
            from: valueFrom,
            options: candidates.map((c) => ({
              label: c.id,
              type: "variable",
              detail: c.name || domain,
            })),
            validFor: RE_KEY,
          };
        }
      }

      if (entry?.type === ConfigEntryType.BOOLEAN) {
        return {
          from: valueFrom,
          options: [
            { label: "true", type: "constant" },
            { label: "false", type: "constant" },
          ],
          validFor: RE_BOOLEAN_VALUE,
        };
      }
      if (entry?.options && entry.options.length > 0) {
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
      // Schema-bundle fallback for the platform-merged case.
      // ``sensor.uptime`` (and a few others) ship empty
      // ``config_entries`` in the prebuilt catalog so
      // ``device_class``'s enum values never reach the entry
      // lookup. Walk ``schema.esphome.io`` (typed-schema variants
      // + extends chain) for an enum with this key. Mirrors the
      // legacy dashboard's enum-value lookup.
      //
      // Use the regex-fallback ``topLevelKey`` / ``platformValue``
      // here — the AST's ``bundleCtx`` is often ``null`` at a
      // value-position cursor sitting on a half-typed pair
      // (``device_class:``), since Lezer hasn't seen the value
      // yet.
      if (completionCtx.topLevelKey) {
        const target = bundleFor(completionCtx.topLevelKey, completionCtx.platformValue);
        const enumValues = await getConfigVarValueOptions(
          api,
          target.bundle,
          target.componentKey,
          key
        );
        if (enumValues.length > 0) {
          return {
            from: valueFrom,
            options: enumValues.map((v) => ({
              label: v.value,
              type: "enum",
              info: v.docs || undefined,
            })),
            validFor: RE_ENUM_VALUE,
          };
        }
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
    const parent = findParentKey(state.doc, lineInfo.number - 1, indent);
    if (!parent) return null;

    const completionCtx = resolveCompletionContext(
      state,
      pos,
      lineInfo.number - 1,
      indent
    );
    const keyCtx: KeyPositionCtx = {
      api,
      catalog,
      ctx,
      state,
      pos,
      partial,
      parent,
      isListItem,
      bundleCtx: completionCtx.bundleCtx,
      platformValue: completionCtx.platformValue,
      topLevelKey: completionCtx.topLevelKey,
      // Automation-list detection: ``then:``, ``else:``, ``on_*:``,
      // and ``*_action:`` (cover ``open_action`` / ``close_action`` /
      // ``stop_action``, lock ``unlock_action``, etc.) all surface
      // the action registry at list-item position.
      inAutomation: isListItem && isUnderAutomationItem(state, pos),
      // Triggers all start with ``on_``; gate the schema fetch on
      // the partial's prefix so non-trigger keystrokes don't burn
      // a round-trip.
      partialCouldBeTrigger:
        ctx.explicit || partial === "" || RE_TRIGGER_PREFIX.test(partial),
    };

    const buckets = await Promise.all(KEY_POSITION_PROVIDERS.map((p) => p.fetch(keyCtx)));
    const options = buckets.flat();
    if (options.length === 0) return null;

    // ``RE_KEY_OR_ACTION`` allows ``.`` because dotted action
    // labels (``logger.log``, ``light.turn_on``) are valid only
    // at the list-item position inside an automation body. For
    // plain key positions (``  partial``), a ``.`` is never a
    // valid continuation — keep the cached options "valid" only
    // while the partial stays a bare key, so typing a dot
    // re-runs the completion source instead of letting CodeMirror
    // hold onto a stale list.
    return {
      from: keyFrom,
      options,
      validFor: isListItem ? RE_KEY_OR_ACTION : RE_KEY,
    };
  };
}

// ─── Key-position completion providers ──────────────────────────────
//
// Each provider owns its structural gate and rendering.
// ``fetch`` returns either an empty array (gate didn't match /
// nothing to surface) or the rendered completions for that
// position. The source assembles them via ``Promise.all`` so
// independent network fetches run in parallel.
//
// Adding a new completion position (action arguments, ID
// references, substitution vars, …) is a new entry in this list
// rather than another ``if`` arm in the source closure.

interface KeyPositionCtx {
  api: ESPHomeAPI;
  catalog: CatalogIndex;
  ctx: CompletionContext;
  state: EditorState;
  pos: number;
  partial: string;
  parent: { key: string };
  isListItem: boolean;
  /** AST-only resolution of the cursor's surrounding component
   *  block. ``null`` when the AST is silent — typically at a
   *  half-typed pair (``device_class:`` with no value yet) that
   *  Lezer hasn't completed. Use this for providers whose
   *  correctness depends on a fully-parsed structure (triggers
   *  on a settled platform context); fall through when null. */
  bundleCtx: { topLevelKey: string; platformValue: string | null } | null;
  /** AST-with-regex-fallback resolution. Always returns the best
   *  available answer, including at half-typed pairs. Use this
   *  for providers whose correctness tolerates a partial parse
   *  (registry / schema-bundle lookup at a list-item dash). */
  platformValue: string | null;
  /** AST-with-regex-fallback resolution of the column-0 ancestor.
   *  Same null-handling guidance as ``platformValue``. */
  topLevelKey: string | null;
  inAutomation: boolean;
  partialCouldBeTrigger: boolean;
  /** Per-turn memo of ``resolveAvailableEntries`` so the catalog
   *  and schema-bundle providers don't re-walk the same answer.
   *  Populated lazily via ``resolveCatalogEntries``. */
  _cachedCatalogEntries?: Promise<ConfigEntry[]>;
}

interface KeyPositionProvider {
  /** Stable name — eyeball debugging only. */
  name: string;
  /** Run the provider; return an empty array to no-op. */
  fetch: (k: KeyPositionCtx) => Promise<Completion[]>;
}

/** Resolve the catalog config-entries for the cursor's parent
 *  exactly once per turn. Both ``catalogEntriesProvider`` and
 *  ``schemaBundleKeyProvider`` need the answer, and the
 *  ``hidden:`` filter is render-time concern — so the providers
 *  read off this memo on the per-turn ``KeyPositionCtx``. The
 *  catalog index plus the in-memory ``fetchComponent`` cache
 *  make this a no-network call, but skipping the duplicate
 *  ``await`` saves one microtask per keystroke. */
async function resolveCatalogEntries(k: KeyPositionCtx): Promise<ConfigEntry[]> {
  if (k.inAutomation) return [];
  if (!k._cachedCatalogEntries) {
    // Pass the AST-with-regex-fallback ``topLevelKey`` so the
    // ``parentKey === "platform"`` carve-out in
    // ``resolveAvailableEntries`` can do its dotted-id lookup
    // (``${topLevelKey}.${platformValue}``) even at half-typed
    // pairs where the AST is silent. (Copilot-flagged: passing
    // ``bundleCtx?.topLevelKey`` discarded the regex fallback.)
    k._cachedCatalogEntries = resolveAvailableEntries(
      k.api,
      k.catalog,
      k.parent.key,
      k.platformValue,
      k.topLevelKey
    );
  }
  return k._cachedCatalogEntries;
}

/** Catalog ``config_entries`` of the parent block, with platform-
 *  merged sub_entries when the parent is a list-item header. */
const catalogEntriesProvider: KeyPositionProvider = {
  name: "catalog-entries",
  fetch: async (k) => {
    const entries = await resolveCatalogEntries(k);
    return entries.filter((e) => !e.hidden).map(entryToCompletion);
  },
};

/** Schema-bundle fallback when the catalog ships an empty
 *  ``config_entries`` for a platform-merged id (``sensor.uptime``
 *  is the canonical case — its prebuilt entry is empty because
 *  the backend's schema sync doesn't expand the typed/extends
 *  chain). Fires only when the catalog provider returned nothing,
 *  so the cheaper path stays the default. */
const schemaBundleKeyProvider: KeyPositionProvider = {
  name: "schema-bundle-keys",
  fetch: async (k) => {
    if (k.inAutomation) return [];
    if (!k.bundleCtx) return [];
    const entries = await resolveCatalogEntries(k);
    if (entries.length > 0) return [];
    const target = bundleFor(k.bundleCtx.topLevelKey, k.bundleCtx.platformValue);
    const keys = await getConfigVarKeys(k.api, target.bundle, target.componentKey);
    return keys.map(schemaKeyToCompletion);
  },
};

/** Typed-schema ``on_*`` triggers (``on_boot``, ``on_press``, …)
 *  from the schema bundle. Gated on the partial starting with
 *  ``o`` so non-trigger keystrokes don't trigger the round-trip. */
const triggerKeysProvider: KeyPositionProvider = {
  name: "trigger-keys",
  fetch: async (k) => {
    if (k.inAutomation) return [];
    if (!k.partialCouldBeTrigger) return [];
    if (!k.bundleCtx) return [];
    const target = bundleFor(k.bundleCtx.topLevelKey, k.bundleCtx.platformValue);
    const triggers = await getTriggerKeys(k.api, target.bundle, target.componentKey);
    return triggers.map(triggerToCompletion);
  },
};

/** Action-registry entries inside a ``then:`` automation body.
 *  Aggregates across every top-level component in the doc so a
 *  config that touches ``logger:`` and ``light:`` gets
 *  ``logger.log`` and ``light.turn_on``. Always includes
 *  ``esphome`` for the core actions (``delay`` / ``if`` /
 *  ``lambda`` / …). */
const actionRegistryProvider: KeyPositionProvider = {
  name: "action-registry",
  fetch: async (k) => {
    if (!k.inAutomation) return [];
    const tops = collectTopLevelKeys(k.state);
    const bundles = [...new Set([...tops, "esphome"])];
    const actions = await getActions(k.api, bundles, [...tops, "core"]);
    return actions.map(actionToCompletion);
  },
};

/** Filter / condition / effect registries — list-item position
 *  whose parent key resolves to a ``type: "registry"``
 *  config-var. Distinct from the action-registry provider which
 *  has its own cross-component aggregation. */
const filterRegistryProvider: KeyPositionProvider = {
  name: "filter-registry",
  fetch: async (k) => {
    if (!k.isListItem || k.inAutomation) return [];
    if (!k.topLevelKey) return [];
    const target = bundleFor(k.topLevelKey, k.platformValue);
    const ref = await lookupRegistryRef(
      k.api,
      target.bundle,
      target.componentKey,
      k.parent.key
    );
    if (!ref) return [];
    const entries = await getRegistryEntries(k.api, ref);
    return entries.map((e) => registryToCompletion(e, k.parent.key));
  },
};

/** Hardcoded ``platform:`` suggestion at list-item position
 *  under a known platform domain (``ota:``, ``binary_sensor:``,
 *  ``sensor:``, …). The catalog only carries dotted platform
 *  implementations (``ota.esphome``, ``binary_sensor.gpio``, …)
 *  so a bare ``platform`` key never appears in
 *  ``config_entries`` — surface it from the catalog's
 *  ``byCategory`` signal. */
const platformKeyProvider: KeyPositionProvider = {
  name: "platform-key",
  fetch: async (k) => {
    if (!k.isListItem || !k.catalog.byCategory.has(k.parent.key)) return [];
    return [
      {
        label: "platform",
        apply: (view, _completion, from, to) =>
          applyKeyInsertion(view, from, to, "platform"),
        type: "property",
        detail: "platform domain",
        boost: 5,
      },
    ];
  },
};

/** Action / filter / condition argument completion. Fires when
 *  ``parent.key`` is a dotted label (``globals.set``,
 *  ``logger.log``, ``binary_sensor.is_on``) or a bare core-action
 *  label (``delay``, ``if``, ``lambda``) — the cursor is inside
 *  the action's argument mapping and the entries to surface are
 *  the action's own ``config_vars``. ``parseRegistryLabel`` returns
 *  the ``(bundleName, componentName, entryName)`` triple;
 *  ``getRegistryEntryKeys`` probes each registry slot (``action``
 *  / ``condition`` / ``filter`` / ``effects``) until one matches.
 *  Skipped when the parent isn't a known label shape. */
const registryEntryArgsProvider: KeyPositionProvider = {
  name: "registry-entry-args",
  fetch: async (k) => {
    // Dotted label, OR the parent is one of the core actions.
    // Core action labels are bare (``delay``, ``if``, …) so we
    // can't distinguish them from arbitrary parent keys without
    // a probe — but ``getRegistryEntryKeys`` returns ``[]`` on
    // a miss and the bundle cache absorbs the cost. Gate on a
    // dotted label OR a bare-but-known automation context to
    // avoid probing every nested-mapping keystroke.
    const isDotted = k.parent.key.includes(".");
    if (!isDotted && !k.inAutomation) return [];
    const ref = parseRegistryLabel(k.parent.key);
    if (!ref) return [];
    const keys = await getRegistryEntryKeys(
      k.api,
      ref.bundleName,
      ref.componentName,
      ref.entryName
    );
    return keys.map(schemaKeyToCompletion);
  },
};

/** Hardcoded ``then:`` suggestion when the cursor sits directly
 *  under an ``on_*`` trigger key. Every ESPHome trigger accepts
 *  a ``then:`` body even if its schema declares no config_vars
 *  (most don't — ``on_press`` and friends have empty schemas). */
const triggerBodyProvider: KeyPositionProvider = {
  name: "trigger-body",
  fetch: async (k) => {
    if (k.inAutomation) return [];
    if (!/^on_[a-z0-9_]*$/.test(k.parent.key)) return [];
    return [
      {
        label: "then",
        apply: (view, _completion, from, to) =>
          applyListBlockInsertion(view, from, to, "then"),
        type: "namespace",
        detail: "trigger body",
        boost: 5,
      },
    ];
  },
};

const KEY_POSITION_PROVIDERS: KeyPositionProvider[] = [
  catalogEntriesProvider,
  schemaBundleKeyProvider,
  triggerKeysProvider,
  actionRegistryProvider,
  filterRegistryProvider,
  registryEntryArgsProvider,
  platformKeyProvider,
  triggerBodyProvider,
];
