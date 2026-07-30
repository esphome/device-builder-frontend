/**
 * Turn component-name code spans in catalog descriptions into links.
 *
 * Descriptions reference sibling components as ``captive_portal:`` /
 * ``web_server:`` code spans (trailing colon, authored convention).
 * When the name is a known catalog component, the span becomes a
 * button: click navigates to the component's section when it is
 * already configured, else opens the add flow targeted at it. Spans
 * that are field refs (``id:``, ``name:``) fail the catalog-known
 * check and stay plain code.
 */
import memoizeOne from "memoize-one";
import {
  canonicalComponentKey,
  RP2_ALIAS_KEY,
  RP2_CANONICAL_KEY,
} from "./component-presence.js";
import { fireEvent } from "./fire-event.js";
import type { CodeLinkResolver } from "./markdown.js";
import type { CatalogIndex } from "./yaml-completion-catalog.js";
import { findAddedSection } from "./yaml-sections.js";

/** Element the click events dispatch from; must carry the live YAML. */
export interface ComponentLinkHost extends EventTarget {
  yaml: string;
}

const COMPONENT_CODE_SPAN_RE = /^[a-z][a-z0-9_.]*:$/;

/** The component id a code span references (`wifi:` → `wifi`), or null. */
export function componentIdFromCodeSpan(text: string): string | null {
  return COMPONENT_CODE_SPAN_RE.test(text) ? text.slice(0, -1) : null;
}

/**
 * Navigate to *id*'s existing section, else request the add flow.
 *
 * Reads `host.yaml` at click time so the verdict tracks live edits.
 */
export function activateComponentLink(host: ComponentLinkHost, id: string): void {
  const target = _sectionTarget(host.yaml, id);
  if (target) {
    fireEvent(host, "section-select", target);
    return;
  }
  fireEvent(host, "request-add-component", { domain: id, componentId: id });
}

/**
 * Resolver for `renderMarkdown`'s `codeLink` option: known catalog ids
 * link, everything else stays plain. Null while *index* is unsettled.
 * Memoized so the resolver's identity is stable across renders.
 */
export const componentLinksFor = memoizeOne(
  (host: ComponentLinkHost, index: CatalogIndex | null): CodeLinkResolver | null => {
    if (!index) return null;
    return (text) => {
      const id = componentIdFromCodeSpan(text);
      if (!id || !index.byId.has(canonicalComponentKey(id))) return null;
      return () => activateComponentLink(host, id);
    };
  }
);

function _sectionTarget(yaml: string, id: string) {
  const direct = findAddedSection(yaml, id, undefined);
  if (direct) return direct;
  if (id === RP2_CANONICAL_KEY) return findAddedSection(yaml, RP2_ALIAS_KEY, undefined);
  if (id === RP2_ALIAS_KEY) return findAddedSection(yaml, RP2_CANONICAL_KEY, undefined);
  return null;
}
