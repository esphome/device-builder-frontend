/**
 * Schema-driven YAML autocompletion — key-position providers.
 *
 * Each provider owns its structural gate and rendering; the
 * completion source assembles their buckets in parallel. Split out of
 * ``yaml-completion`` so the source closure stays focused on cursor
 * dispatch. Depends only on the catalog layer
 * (``yaml-completion-catalog``) and the completion-item builders
 * (``yaml-completion-items``) — never back on the source.
 */
import type { Completion, CompletionContext } from "@codemirror/autocomplete";
import type { EditorState } from "@codemirror/state";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import type { ConfigEntry } from "../api/types/config-entries.js";
import {
  getActions,
  getConfigVarKeys,
  getRegistryEntries,
  getRegistryEntryKeys,
  getTriggerKeys,
  lookupRegistryRef,
  parseRegistryLabel,
} from "./esphome-schema.js";
import { collectTopLevelKeys } from "./yaml-ast.js";
import {
  bundleFor,
  type CatalogIndex,
  type CompletionTarget,
  nestedPathForParent,
  resolveAvailableEntries,
} from "./yaml-completion-catalog.js";
import {
  actionToCompletion,
  applyKeyInsertion,
  applyListBlockInsertion,
  entryToCompletion,
  registryToCompletion,
  schemaKeyToCompletion,
  triggerToCompletion,
} from "./yaml-completion-items.js";

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

export interface KeyPositionCtx {
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
  /** Device platform/board so body hydration resolves per-platform
   *  value options. */
  deviceTarget?: CompletionTarget;
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
      k.topLevelKey,
      () => nestedPathForParent(k.state, k.pos, k.parent.key),
      k.deviceTarget
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

export const KEY_POSITION_PROVIDERS: KeyPositionProvider[] = [
  catalogEntriesProvider,
  schemaBundleKeyProvider,
  triggerKeysProvider,
  actionRegistryProvider,
  filterRegistryProvider,
  registryEntryArgsProvider,
  platformKeyProvider,
  triggerBodyProvider,
];
