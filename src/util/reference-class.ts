/**
 * Which configured blocks can satisfy a reference that needs a specific id
 * class (``references_class``), judged from the catalog index. Fails open
 * everywhere: a block is rejected only when its classes are known and lack
 * the required one.
 */
import type { ComponentCatalogIndexEntry } from "../api/types/components.js";
import type { ConfigEntry } from "../api/types/config-entries.js";
import { yamlHasExternalIdSources } from "./config-entry-yaml-scan.js";
import { splitYamlDocLines } from "./yaml-doc-lines.js";
import { parseYamlSectionValues } from "./yaml-section-reader.js";
import {
  hasHiddenKeys,
  parseYamlTopLevelSections,
  qualifiedSectionKey,
  type YamlSection,
} from "./yaml-sections-core.js";

export type CatalogById = ReadonlyMap<string, ComponentCatalogIndexEntry>;

/** What the class check makes of a reference's candidates. */
export interface ClassVerdict<T> {
  /** The candidates whose id may inherit the required class. Only a
   *  top-level section id whose component's known classes lack it is dropped. */
  candidates: T[];
  /** The domain is configured, but every block of it is known to be the wrong
   *  class: each offered id fails, and so does each id-less block esphome
   *  could auto-resolve to. */
  noneMatch: boolean;
}

/**
 * Judge *all*, the unfiltered candidates of the reference *entry*, in one pass.
 * An entry with no ``references_class``, or no index yet, keeps every
 * candidate and never reports none match.
 */
export function classVerdict<T extends { id: string }>(
  yaml: string,
  all: T[],
  entry: ConfigEntry,
  byId: CatalogById | null | undefined
): ClassVerdict<T> {
  const required = entry.references_class;
  if (!required || !byId) return { candidates: all, noneMatch: false };
  const judge = sectionJudge(yaml, required, byId);
  const byIdSection = new Map<string, YamlSection>();
  const idless: YamlSection[] = [];
  for (const section of parseYamlTopLevelSections(yaml)) {
    if (section.id) byIdSection.set(section.id, section);
    else idless.push(section);
  }
  const candidates = all.filter((candidate) => {
    const section = byIdSection.get(candidate.id);
    return !section || judge(section);
  });
  // A merged source may hold a matching block the scan can't see.
  if (candidates.length || yamlHasExternalIdSources(yaml)) {
    return { candidates, noneMatch: false };
  }
  const domain = entry.references_component;
  // An id-less provider block (``modbus_bridge:``) may be what Auto resolves to.
  const provides = (section: YamlSection): boolean =>
    byId
      .get(qualifiedSectionKey(section.key, section.platform))
      ?.provides?.includes(domain ?? "") ?? false;
  if (idless.some(provides)) return { candidates, noneMatch: false };
  const own = idless.filter((section) => section.key === domain);
  return {
    candidates,
    noneMatch: (all.length > 0 || own.length > 0) && !own.some(judge),
  };
}

/** A verdict per section: false only when its classes are known to lack
 *  *required*. */
function sectionJudge(
  yaml: string,
  required: string,
  byId: CatalogById
): (section: YamlSection) => boolean {
  let lines: string[] | null = null;
  return (section) => {
    const component = byId.get(qualifiedSectionKey(section.key, section.platform));
    if (!component) return true;
    let classes = component.id_classes;
    // A typed schema has one discriminator; more than one can't be judged.
    const [variant, ...others] = Object.entries(component.id_classes_by_variant ?? {});
    if (others.length) return true;
    if (variant) {
      const [key, byValue] = variant;
      lines ??= splitYamlDocLines(yaml);
      if (hasHiddenKeys(lines, section) || isOpaque(lines, section)) return true;
      const value = parseYamlSectionValues(yaml, section.key, section.fromLine)[key];
      // Unset keeps ``id_classes``, the default variant's.
      if (value != null) {
        // A substitution or a value the catalog doesn't know: can't judge.
        if (!Object.prototype.hasOwnProperty.call(byValue, String(value))) return true;
        classes = byValue[String(value)];
      }
    }
    return !classes?.length || classes.includes(required);
  };
}

// A flow mapping / sequence or a whole-value alias (``modbus: [{ ... }]``,
// ``- { ... }``, ``modbus: *hub``), anchored or tagged or not, holds keys a
// line scan can't read.
const OPAQUE_VALUE_RE = /^\s*(?:-\s+|[\w.]+\s*:\s*)+(?:[&!]\S+\s+)*[[{*]/;

function isOpaque(lines: string[], section: YamlSection): boolean {
  return OPAQUE_VALUE_RE.test(lines[section.fromLine - 1] ?? "");
}
