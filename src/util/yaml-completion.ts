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
import type { ESPHomeAPI } from "../api/esphome-api.js";
import {
  ConfigEntryType,
  type ComponentCatalogEntry,
  type ConfigEntry,
} from "../api/types.js";

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

// ─── YAML structural inspection (regex-based) ────────────────────────
//
// We don't parse the YAML — that would re-implement the lezer grammar.
// Indentation + the "most recent key at a shallower indent" heuristic
// is enough to know where the cursor is in the document hierarchy.
//
// Returns the indentation depth of `line` (count of leading spaces).
function indentOf(line: string): number {
  let i = 0;
  while (i < line.length && line[i] === " ") i++;
  return i;
}

/** Strip inline `# comment` and trailing whitespace. */
function stripComment(line: string): string {
  // Only treat `#` as a comment when it's preceded by whitespace or starts
  // the line — `#RRGGBB` color values are valid YAML scalars.
  const m = line.match(/(^|\s)#/);
  if (!m) return line.trimEnd();
  return line.slice(0, m.index! + m[0].length - 1).trimEnd();
}

/**
 * Walking up from `lineIdx`, return the nearest key-line whose indent is
 * strictly less than `belowIndent`. Used to find the parent block of the
 * current cursor position.
 */
function findParentKey(
  lines: string[],
  lineIdx: number,
  belowIndent: number,
): { key: string; indent: number; lineIdx: number } | null {
  for (let i = lineIdx - 1; i >= 0; i--) {
    const raw = lines[i];
    const stripped = stripComment(raw);
    if (!stripped.trim()) continue;
    const ind = indentOf(stripped);
    if (ind >= belowIndent) continue;
    // Match `<indent>key:` or `<indent>- key:` (list-of-mappings).
    const keyMatch = stripped.match(/^\s*(?:-\s+)?([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (keyMatch) {
      return { key: keyMatch[1], indent: ind, lineIdx: i };
    }
  }
  return null;
}

/**
 * Walk up to find the *top-level* component block the cursor sits under
 * (the first key at column 0 above the cursor).
 */
function findTopLevelBlock(
  lines: string[],
  lineIdx: number,
): string | null {
  for (let i = lineIdx - 1; i >= 0; i--) {
    const raw = lines[i];
    const stripped = stripComment(raw);
    if (!stripped.trim()) continue;
    if (indentOf(stripped) !== 0) continue;
    const m = stripped.match(/^([A-Za-z0-9_]+)\s*:/);
    if (m) return m[1];
  }
  return null;
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
    apply: `${c.id}:\n  `,
    type: "class",
    detail: c.category,
    info: buildComponentInfo(c),
  };
}

function platformValueCompletion(c: ComponentCatalogEntry): Completion {
  return {
    label: c.id,
    type: "enum",
    detail: c.category,
    info: buildComponentInfo(c),
  };
}

// ─── Lookups ─────────────────────────────────────────────────────────

/**
 * Resolve the config entries available *under* a parent key. Handles the
 * `sensor: - platform: dht` case: when the parent is a category-style block
 * (sensor/binary_sensor/switch/...) and the current item declares a
 * `platform: <id>`, merge the platform component's config entries with
 * any matching sub_entries from the parent.
 */
async function resolveAvailableEntries(
  api: ESPHomeAPI,
  catalog: CatalogIndex,
  parentKey: string,
  platformValue: string | null,
): Promise<ConfigEntry[]> {
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
    }
    return directHit.config_entries;
  }
  // No direct hit — try fetching the component (handles aliases the catalog
  // list call doesn't return). Tolerate failures silently.
  try {
    const comp = await api.getComponent(parentKey);
    if (comp) return comp.config_entries;
  } catch {
    /* ignore */
  }
  return [];
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
    const commentStart = before.match(/(^|\s)#/);
    if (commentStart && commentStart.index !== undefined) {
      const idx = commentStart.index + commentStart[0].length - 1;
      if (colInLine > idx) return null;
    }

    const allLines = state.doc.toString().split("\n");

    // ── Value position: `key:` already on this line, cursor after the colon.
    const valueMatch = before.match(/^(\s*)([A-Za-z0-9_]+)\s*:\s*(\S*)$/);
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
              validFor: /^[A-Za-z0-9_]*$/,
            };
          }
        }
      }

      // Resolve the entry being set so we can value-complete against it.
      const parent = findParentKey(allLines, lineInfo.number - 1, indent);
      let entries: ConfigEntry[] = [];
      if (parent) {
        // Look up the platform sibling (sibling key on the same indent).
        const platformValue = readPlatformSibling(allLines, lineInfo.number - 1, indent);
        entries = await resolveAvailableEntries(api, catalog, parent.key, platformValue);
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
          validFor: /^[A-Za-z]*$/,
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
          validFor: /^[A-Za-z0-9_./-]*$/,
        };
      }
      return null;
    }

    // ── Key position: the user is typing a key (just whitespace + word so far).
    const keyMatch = before.match(/^(\s*)([A-Za-z0-9_]*)$/);
    if (!keyMatch) return null;

    const [, leading, partial] = keyMatch;
    const indent = leading.length;
    const keyFrom = pos - partial.length;

    if (!ctx.explicit && partial.length === 0) return null;

    const catalog = await loadCatalog(api);

    // Top-level (column 0) → component IDs.
    if (indent === 0) {
      return {
        from: keyFrom,
        options: catalog.components.map(componentToCompletion),
        validFor: /^[A-Za-z0-9_]*$/,
      };
    }

    // Nested → config_entries of the parent block (or platform-merged).
    const parent = findParentKey(allLines, lineInfo.number - 1, indent);
    if (!parent) return null;

    const platformValue = readPlatformSibling(allLines, lineInfo.number - 1, indent);
    const entries = await resolveAvailableEntries(
      api,
      catalog,
      parent.key,
      platformValue,
    );
    if (entries.length === 0) return null;

    return {
      from: keyFrom,
      options: entries
        .filter((e) => !e.hidden)
        .map(entryToCompletion),
      validFor: /^[A-Za-z0-9_]*$/,
    };
  };
}

/**
 * Look for a `platform:` sibling at the same indent level as the current
 * cursor. Walks up first to find the start of the current list item or
 * mapping, then scans both directions.
 */
function readPlatformSibling(
  lines: string[],
  lineIdx: number,
  indent: number,
): string | null {
  // Walk up while we're at the same indent — a new list item starts with
  // `- ` at indent-2 (or wherever the parent's indent is).
  let topOfBlock = lineIdx;
  for (let i = lineIdx - 1; i >= 0; i--) {
    const raw = lines[i];
    const stripped = stripComment(raw);
    if (!stripped.trim()) continue;
    const ind = indentOf(stripped);
    if (ind < indent) break;
    if (ind === indent) {
      topOfBlock = i;
      // Stop when we hit a list-item dash — the item starts here.
      if (/^\s*-\s/.test(raw)) break;
    }
  }
  // Scan forward from topOfBlock until indent drops below `indent`.
  for (let i = topOfBlock; i < lines.length; i++) {
    const raw = lines[i];
    const stripped = stripComment(raw);
    if (!stripped.trim()) continue;
    const ind = indentOf(stripped);
    if (i !== topOfBlock && ind < indent) break;
    const m = stripped.match(/^\s*(?:-\s+)?platform\s*:\s*([A-Za-z0-9_]+)\s*$/);
    if (m) return m[1];
  }
  return null;
}
