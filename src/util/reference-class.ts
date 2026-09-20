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

/** The *candidates* whose id may inherit the class *entry* requires. Only a
 *  top-level section id whose component's known classes lack it is dropped. */
export function classCandidates<T extends { id: string }>(
  yaml: string,
  candidates: T[],
  entry: ConfigEntry,
  byId: CatalogById | null | undefined
): T[] {
  const required = entry.references_class;
  if (!required || !byId || !candidates.length) return candidates;
  const judge = sectionJudge(yaml, required, byId);
  const sections = new Map<string, YamlSection>();
  for (const section of parseYamlTopLevelSections(yaml)) {
    if (section.id) sections.set(section.id, section);
  }
  return candidates.filter((candidate) => {
    const section = sections.get(candidate.id);
    return !section || judge(section);
  });
}

/**
 * Whether the referenced domain is configured, but every block of it is
 * known to be the wrong class: each offered id fails, and so does each
 * id-less block esphome could auto-resolve to.
 */
export function noneMatchClass(
  yaml: string,
  allCandidates: { id: string }[],
  entry: ConfigEntry,
  byId: CatalogById | null | undefined
): boolean {
  const required = entry.references_class;
  // A merged source may hold a matching block the scan can't see.
  if (!required || !byId || yamlHasExternalIdSources(yaml)) return false;
  if (classCandidates(yaml, allCandidates, entry, byId).length) return false;
  const judge = sectionJudge(yaml, required, byId);
  const domain = entry.references_component;
  const idless = parseYamlTopLevelSections(yaml).filter((section) => !section.id);
  // An id-less provider block (``modbus_bridge:``) may be what Auto resolves to.
  const provides = (section: YamlSection): boolean =>
    byId
      .get(qualifiedSectionKey(section.key, section.platform))
      ?.provides?.includes(domain ?? "") ?? false;
  if (idless.some(provides)) return false;
  const own = idless.filter((section) => section.key === domain);
  return (allCandidates.length > 0 || own.length > 0) && !own.some(judge);
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
// ``- { ... }``, ``modbus: *hub``) holds keys a line scan can't read.
const OPAQUE_VALUE_RE = /^\s*(?:-\s+|[\w.]+\s*:\s*)+[[{*]/;

function isOpaque(lines: string[], section: YamlSection): boolean {
  return OPAQUE_VALUE_RE.test(lines[section.fromLine - 1] ?? "");
}
