/**
 * Schema-driven hover docs for the ESPHome YAML editor.
 *
 * The structured editor panel already documents a component's visible
 * ``config_entries`` (and the component header), so a hover that repeats
 * those is noise. This resolver instead surfaces docs for the keys that
 * only exist in raw YAML — resolving against the full schema bundle
 * (``schema.esphome.io`` via ``esphome-schema.ts``) and *suppressing*
 * anything the form already shows:
 *
 *   - enum values (``device_class: garage_door`` → that option's meaning)
 *   - automation actions / triggers (``on_press:``, ``logger.log`` — the
 *     backend strips these from ``config_entries``)
 *   - registry/filter list entries (``sensor.filters`` members)
 *   - deeply-nested schema keys not in the curated catalog
 *
 * Top-level component keys always show their catalog description; nested
 * keys the structured editor already documents (visible ``config_entries``)
 * resolve to ``null`` (no tooltip).
 */
import type { EditorState } from "@codemirror/state";
import { hoverTooltip, type Tooltip } from "@codemirror/view";
import { html, nothing, render } from "lit";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import type { ComponentCatalogEntry } from "../api/types/components.js";
import type { ConfigEntry } from "../api/types/config-entries.js";
import {
  getActions,
  getConfigVarDocsAtPath,
  getConfigVarValueOptions,
  getRegistryEntries,
  getTriggerKeys,
  lookupRegistryRef,
} from "./esphome-schema.js";
import { isSafeLinkHref, renderMarkdown } from "./markdown.js";
import {
  collectTopLevelKeys,
  getKeyPath,
  isUnderAutomationItem,
  resolveBundleContext,
} from "./yaml-ast.js";
import { bundleFor, loadCatalog, type CatalogIndex } from "./yaml-completion.js";
import {
  findParentKey,
  findTopLevelBlock,
  indentOf,
  RE_INLINE_COMMENT_BOUNDARY,
  RE_PAIR_LINE,
  readPlatformSibling,
  stripComment,
} from "./yaml-line-walker.js";

/** Resolved hover content — Markdown docs plus an optional "See also" link. */
export interface HoverTarget {
  description: string | null;
  docsUrl: string | null;
  docsTitle: string | null;
}

/** Strip one layer of matched quotes (mirrors the AST / line-walker). */
function unquote(value: string): string {
  if (value.length < 2) return value;
  const q = value[0];
  if ((q === '"' || q === "'") && value[value.length - 1] === q) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Trailing ``See also: [Title](url)`` footer the schema docstrings carry,
 * usually italic-wrapped (``*See also: [Light Component](…)*``). It's
 * pulled out so it renders as a real "See also" link — the inline
 * Markdown renderer deliberately doesn't recurse into italic, so left in
 * place the link would show as raw ``[text](url)`` text.
 */
const SEE_ALSO_RE = /\s*\*?\s*See also:\s*\[([^\]]+)\]\(([^)]+)\)\*?\s*$/i;

/** Build a hover target from a schema docs string, splitting off any
 *  trailing "See also" link into a proper docs link. */
function docsTarget(docs: string | null | undefined): HoverTarget | null {
  if (!docs) return null;
  const m = docs.match(SEE_ALSO_RE);
  const description = (m ? docs.slice(0, m.index) : docs).trim() || null;
  const docsUrl = m ? m[2] : null;
  if (!description && !docsUrl) return null;
  return { description, docsUrl, docsTitle: m ? m[1] : null };
}

/** Catalog description for a top-level component, with its docs link. */
function componentTarget(c: ComponentCatalogEntry): HoverTarget | null {
  if (!c.description && !c.docs_url) return null;
  return {
    description: c.description || null,
    docsUrl: c.docs_url || null,
    docsTitle: c.name || null,
  };
}

/** Find a ConfigEntry by key anywhere in the (recursive) entry tree. */
function findConfigEntry(entries: ConfigEntry[], key: string): ConfigEntry | undefined {
  for (const e of entries) {
    if (e.key === key) return e;
    const nested = e.config_entries?.length
      ? findConfigEntry(e.config_entries, key)
      : undefined;
    if (nested) return nested;
  }
  return undefined;
}

/** True when *key* is a visible (non-hidden) catalog field of *comp* —
 *  i.e. the structured editor already documents it, so hover should not. */
function formDocuments(comp: ComponentCatalogEntry | undefined, key: string): boolean {
  if (!comp) return false;
  const entry = findConfigEntry(comp.config_entries ?? [], key);
  return !!entry && !entry.hidden;
}

/**
 * Resolve schema docs for the YAML token under *pos*, or ``null`` when
 * nothing applies (or the structured editor already documents it).
 * Reuses the completion source's context helpers so hover and completion
 * agree on structure.
 */
export async function resolveHoverTarget(
  state: EditorState,
  pos: number,
  api: ESPHomeAPI,
  catalog: CatalogIndex
): Promise<HoverTarget | null> {
  const line = state.doc.lineAt(pos);
  const stripped = stripComment(line.text);
  const m = stripped.match(RE_PAIR_LINE);
  if (!m) return null;
  const key = m[1];
  const rest = m[2];
  const indent = indentOf(stripped);
  const lineIdx = line.number - 1;
  const allLines = state.doc.toString().split("\n");

  // Top-level component key → its catalog description. Always shown
  // (even though the structured editor documents it) so a hover
  // confirms what a block is at a glance.
  if (indent === 0) {
    const c = catalog.byId.get(key);
    return c ? componentTarget(c) : null;
  }

  const bundleCtx = resolveBundleContext(state, pos);
  const topLevelKey = bundleCtx?.topLevelKey ?? findTopLevelBlock(allLines, lineIdx);
  const platformValue = bundleCtx
    ? bundleCtx.platformValue
    : readPlatformSibling(allLines, lineIdx, indent);

  // Pointer over the value (right of the first colon) with a value present.
  const colInLine = pos - line.from;
  const colonIdx = line.text.indexOf(":");
  const overValue = colonIdx >= 0 && colInLine > colonIdx && rest.trim().length > 0;

  // 1. Enum value → that option's meaning (the form's dropdown never
  //    shows per-value docs, so this is always worth surfacing).
  if (overValue) {
    if (!topLevelKey) return null;
    const { bundle, componentKey } = bundleFor(topLevelKey, platformValue);
    const options = await getConfigVarValueOptions(api, bundle, componentKey, key);
    return docsTarget(options.find((o) => o.value === unquote(rest.trim()))?.docs);
  }

  const isListItem = /^\s*-\s/.test(line.text);

  // 2. Automation action key (list item under then:/else:/on_*:/*_action:).
  if (isListItem && isUnderAutomationItem(state, pos)) {
    const tops = collectTopLevelKeys(state);
    const bundles = [...new Set([...tops, "esphome"])];
    const actions = await getActions(api, bundles, [...tops, "core"]);
    return docsTarget(actions.find((a) => a.key === key)?.docs);
  }

  // 3. Trigger key (on_*).
  if (key.startsWith("on_") && topLevelKey) {
    const { bundle, componentKey } = bundleFor(topLevelKey, platformValue);
    const triggers = await getTriggerKeys(api, bundle, componentKey);
    const hit = triggers.find((t) => t.key === key);
    if (hit?.docs) return docsTarget(hit.docs);
  }

  const parent = findParentKey(allLines, lineIdx, indent);

  // 4. Registry / filter list entry (parent key is a registry config-var).
  if (isListItem && parent && topLevelKey) {
    const { bundle, componentKey } = bundleFor(topLevelKey, platformValue);
    const ref = await lookupRegistryRef(api, bundle, componentKey, parent.key);
    if (ref) {
      const entries = await getRegistryEntries(api, ref);
      const hit = entries.find((e) => e.key === key);
      if (hit?.docs) return docsTarget(hit.docs);
    }
  }

  // 5. Nested / plain key. Suppress what the structured editor documents:
  //    top-level component keys and visible catalog config_entries.
  const path = getKeyPath(state, pos);
  if (indent === 0 || path.length <= 1 || !topLevelKey) return null;
  const { bundle, componentKey } = bundleFor(topLevelKey, platformValue);
  const comp = catalog.byId.get(componentKey) ?? catalog.byId.get(topLevelKey);
  if (formDocuments(comp, key)) return null;
  return docsTarget(
    await getConfigVarDocsAtPath(api, bundle, componentKey, path.slice(1))
  );
}

/** Build the tooltip DOM: Markdown description + optional "See also" link. */
function buildHoverDom(target: HoverTarget, seeAlsoLabel: string): HTMLElement {
  const dom = document.createElement("div");
  dom.className = "cm-esphome-info cm-esphome-hover";
  const seeAlso =
    target.docsUrl && isSafeLinkHref(target.docsUrl)
      ? html`<div class="cm-esphome-info-meta">
          ${seeAlsoLabel}
          <a
            class="md-link"
            href=${target.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            >${target.docsTitle ?? target.docsUrl}</a
          >
        </div>`
      : nothing;
  render(
    html`${target.description
      ? html`<p>${renderMarkdown(target.description)}</p>`
      : nothing}${seeAlso}`,
    dom
  );
  return dom;
}

/** True when *pos* sits inside a ``# comment`` on its line. */
function inComment(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  const m = before.match(RE_INLINE_COMMENT_BOUNDARY);
  if (!m || m.index === undefined) return false;
  return pos - line.from > m.index + m[0].length - 1;
}

/**
 * CodeMirror hover-tooltip extension backed by the component catalog.
 * ``getSeeAlsoLabel`` is read per-tooltip so a locale switch is picked
 * up without rebuilding the editor.
 */
export function createYamlHoverTooltip(api: ESPHomeAPI, getSeeAlsoLabel: () => string) {
  return hoverTooltip(
    async (view, pos): Promise<Tooltip | null> => {
      if (inComment(view.state, pos)) return null;
      const word = view.state.wordAt(pos);
      if (!word) return null;
      let catalog: CatalogIndex;
      try {
        catalog = await loadCatalog(api);
      } catch {
        return null;
      }
      const target = await resolveHoverTarget(view.state, pos, api, catalog);
      if (!target) return null;
      return {
        pos: word.from,
        end: word.to,
        above: true,
        create: () => ({ dom: buildHoverDom(target, getSeeAlsoLabel()) }),
      };
    },
    // Only a deliberate pause triggers the tooltip — the 300ms default
    // fires on an incidental pointer rest while editing, which reads as
    // noise. Hide it the moment the doc changes (the user resumed typing).
    { hideOnChange: true, hoverTime: 700 }
  );
}
