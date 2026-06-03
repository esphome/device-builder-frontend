/**
 * Schema-driven hover docs for the ESPHome YAML editor.
 *
 * Full parity with the legacy editor's hover: every YAML token that maps
 * to something documented gets a tooltip. Docs come from the full schema
 * bundle (``schema.esphome.io`` via ``esphome-schema.ts``), with the
 * component catalog as the fallback:
 *
 *   - top-level component keys → catalog description
 *   - enum values (``device_class: garage_door``) → that option's meaning
 *   - automation actions / triggers (``on_press:``, ``logger.log``)
 *   - registry/filter list entries (``sensor.filters`` members)
 *   - any config key, nested or not → schema docs, else its catalog
 *     ``config_entry`` description
 */
import type { EditorState } from "@codemirror/state";
import { hoverTooltip, type Tooltip } from "@codemirror/view";
import { html, nothing, render } from "lit";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import type { ComponentCatalogEntry } from "../api/types/components.js";
import type { ConfigEntry } from "../api/types/config-entries.js";
import { isYamlOnlySection } from "../components/device/yaml-only-sections.js";
import { fetchComponent } from "./component-name-cache.js";
import {
  getActions,
  getComponentDocs,
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

/** Catalog field description + docs link — the fallback for keys the
 *  schema walk doesn't carry docs for. Prefixes the field type in bold
 *  (``**string**: …``) to match the legacy editor, whose schema-sourced
 *  docs carry that prefix verbatim. */
function fieldTarget(
  entry: ConfigEntry,
  owner: ComponentCatalogEntry | undefined
): HoverTarget | null {
  const docsUrl = entry.help_link || owner?.docs_url || null;
  if (!entry.description && !docsUrl) return null;
  return {
    description: entry.description ? `**${entry.type}**: ${entry.description}` : null,
    docsUrl,
    docsTitle: owner?.name || null,
  };
}

/**
 * True when the structured editor has no form for the component (no
 * ``config_entries`` like ``ethernet``, or an always-YAML section). Same
 * check the structured editor uses, so hover and form stay in sync.
 */
async function isYamlOnlyComponent(
  api: ESPHomeAPI,
  topLevelKey: string,
  platformValue: string | null
): Promise<boolean> {
  const componentId = platformValue ? `${topLevelKey}.${platformValue}` : topLevelKey;
  const comp = await fetchComponent(api, componentId);
  // `config_entries` is absent (not []) on form-less components like ethernet.
  return isYamlOnlySection(topLevelKey, comp?.config_entries?.length ?? 0);
}

/**
 * Resolve hover docs for the YAML token under *pos*, or ``null`` when
 * nothing maps. Reuses the completion source's context helpers so hover
 * and completion agree on structure.
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

  const bundleCtx = resolveBundleContext(state, pos);
  const topLevelKey = bundleCtx?.topLevelKey ?? findTopLevelBlock(state.doc, lineIdx);
  const platformValue = bundleCtx
    ? bundleCtx.platformValue
    : readPlatformSibling(state.doc, lineIdx, indent);

  // Don't duplicate the structured editor: skip components it can form-edit.
  if (topLevelKey && !(await isYamlOnlyComponent(api, topLevelKey, platformValue))) {
    return null;
  }

  // Top-level component / domain key → its docs. Prefer the schema's
  // core component/platform docs (covers bare domains like
  // ``binary_sensor:`` the catalog lacks), falling back to the catalog.
  if (indent === 0) {
    const schemaDocs = await getComponentDocs(api, key);
    if (schemaDocs) return docsTarget(schemaDocs);
    const c = catalog.byId.get(key);
    return c ? componentTarget(c) : null;
  }

  // Pointer over the value (right of the first colon) with a value present.
  const colInLine = pos - line.from;
  const colonIdx = line.text.indexOf(":");
  const overValue = colonIdx >= 0 && colInLine > colonIdx && rest.trim().length > 0;

  // 1. Value position.
  if (overValue) {
    if (!topLevelKey) return null;
    // ``platform: <value>`` → the platform component's description.
    if (key === "platform") {
      const c = catalog.byId.get(`${topLevelKey}.${unquote(rest.trim())}`);
      return c ? componentTarget(c) : null;
    }
    // Otherwise an enum value → that option's meaning (the form's
    // dropdown never shows per-value docs).
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

  const parent = findParentKey(state.doc, lineIdx, indent);

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

  // 5. Nested / plain key. Full parity with the legacy editor — every
  //    key gets docs: the schema walk first, then the catalog field
  //    description for keys the schema doesn't carry docs for.
  const path = getKeyPath(state, pos);
  if (path.length <= 1 || !topLevelKey) return null;
  const { bundle, componentKey } = bundleFor(topLevelKey, platformValue);
  const schemaDocs = await getConfigVarDocsAtPath(
    api,
    bundle,
    componentKey,
    path.slice(1)
  );
  if (schemaDocs) return docsTarget(schemaDocs);
  // Catalog fallback. The catalog keys platforms as ``<domain>.<stem>``
  // (``binary_sensor.gpio``), the reverse of the schema bundle's
  // ``<stem>.<domain>`` componentKey — use the catalog form here.
  const catalogId = platformValue ? `${topLevelKey}.${platformValue}` : topLevelKey;
  const comp = catalog.byId.get(catalogId);
  const entry = comp ? findConfigEntry(comp.config_entries ?? [], key) : undefined;
  return entry ? fieldTarget(entry, comp) : null;
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
      let target: HoverTarget | null;
      try {
        const catalog = await loadCatalog(api);
        target = await resolveHoverTarget(view.state, pos, api, catalog);
      } catch (err) {
        // The catalog/schema fetches degrade gracefully on their own, so
        // reaching here is an unexpected error — warn (visible by default,
        // unlike debug) since a persistent failure silently kills hovers.
        console.warn("[yaml-hover] failed to resolve hover docs:", err);
        return null;
      }
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
    { hideOnChange: true, hoverTime: 500 }
  );
}
