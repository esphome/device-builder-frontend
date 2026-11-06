import memoizeOne from "memoize-one";
import { CORE_CATEGORIES } from "../../api/types/components.js";
import { parseSubstitutions } from "../../util/substitutions.js";
import type { CatalogIndex } from "../../util/yaml-completion-catalog.js";
import {
  categorizeSections,
  CORE_KEYS,
  parseYamlAutomations,
  parseYamlTopLevelSections,
  type YamlSection,
} from "../../util/yaml-sections.js";

export interface NavigatorBuckets {
  core: YamlSection[];
  components: YamlSection[];
  automations: YamlSection[];
  /** The file's own top-level ``substitutions:``, for label resolution. */
  substitutions: Map<string, string>;
}

/**
 * Parse + categorize + filter + sort the YAML into the three navigator
 * buckets. Two parser passes and three list traversals collapse into a
 * single result; the navigator memoises it on the YAML source.
 */
export function deriveNavigatorBuckets(
  yaml: string,
  coreKeys: ReadonlySet<string> = CORE_KEYS
): NavigatorBuckets {
  const {
    core,
    components,
    automations: topLevelAutomations,
  } = categorizeSections(parseYamlTopLevelSections(yaml), coreKeys);
  // ``parseYamlAutomations`` enumerates individual ``script:`` /
  // ``interval:`` list items as stable-keyed entries; drop the bare
  // top-level blocks so each automation shows up exactly once.
  const detailed = parseYamlAutomations(yaml);
  const filteredTopLevel = topLevelAutomations.filter(
    (s) => s.key !== "script" && s.key !== "interval"
  );
  // Drop ``light_effect`` (managed via the parent light's section
  // editor) and ``unscoped`` entries (inline ``on_*:`` handlers on
  // id-less components that the structured editor can't address).
  const automations = [...filteredTopLevel, ...detailed]
    .filter(
      (s) =>
        !s.key.startsWith("automation:light_effect:") &&
        !s.key.startsWith("automation:unscoped:")
    )
    .sort((a, b) => a.fromLine - b.fromLine);
  return { core, components, automations, substitutions: parseSubstitutions(yaml) };
}

/** `CORE_KEYS` plus the domain of every catalog entry in `CORE_CATEGORIES`. */
export const navigatorCoreKeys = memoizeOne(
  (catalog: CatalogIndex | null): ReadonlySet<string> => {
    if (!catalog) return CORE_KEYS;
    const keys = new Set(CORE_KEYS);
    for (const category of CORE_CATEGORIES) {
      for (const entry of catalog.byCategory.get(category) ?? []) {
        keys.add(entry.id.split(".", 1)[0]);
      }
    }
    return keys;
  }
);
