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
import { type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import { ConfigEntryType } from "../api/types/config-entries.js";
import { findReferenceCandidates, parseCatalogId } from "./config-entry-yaml-scan.js";
import { getConfigVarValueOptions } from "./esphome-schema.js";
import { collectSubstitutionKeys, isUnderAutomationItem } from "./yaml-ast.js";
import {
  bundleFor,
  loadCatalog,
  matchKeyPosition,
  RE_BOOLEAN_VALUE,
  RE_ENUM_VALUE,
  RE_KEY,
  RE_KEY_OR_ACTION,
  RE_TRIGGER_PREFIX,
  RE_VALUE_POSITION,
  resolveAvailableEntries,
  resolveCompletionContext,
} from "./yaml-completion-catalog.js";
import {
  buildTopLevelCompletions,
  platformValueCompletion,
} from "./yaml-completion-items.js";
import {
  KEY_POSITION_PROVIDERS,
  type KeyPositionCtx,
} from "./yaml-completion-providers.js";
import {
  findParentKey,
  findTopLevelBlock,
  RE_INLINE_COMMENT_BOUNDARY,
} from "./yaml-line-walker.js";

// ── Public surface preserved across the catalog / provider split ──
// Consumers (``yaml-hover``, ``yaml-completion-items``, the
// top-level-completion tests) import these from ``yaml-completion``
// directly; their implementations now live in the extracted
// ``yaml-completion-catalog`` and ``yaml-completion-items`` modules.
export { matchValuePosition, type CatalogIndex } from "./yaml-completion-catalog.js";
export {
  buildTopLevelCompletions,
  bundleFor,
  loadCatalog,
  matchKeyPosition,
  platformValueCompletion,
  resolveAvailableEntries,
};

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
