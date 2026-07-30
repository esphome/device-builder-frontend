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
import { canonicalComponentKey, platformKeyAlias } from "./component-presence.js";
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
  fireEvent(host, "request-add-component", { componentId: id });
}

/**
 * Resolver for `renderMarkdown`'s `codeLink` option: known catalog ids
 * link, everything else stays plain. Null while *index* is unsettled.
 * Handlers are cached per id so their identity is render-stable;
 * memoize the call itself on the host so the resolver's is too.
 */
export function componentLinksFor(
  host: ComponentLinkHost,
  index: CatalogIndex | null
): CodeLinkResolver | null {
  if (!index) return null;
  const handlers = new Map<string, () => void>();
  return (text) => {
    const id = componentIdFromCodeSpan(text);
    if (!id || !index.byId.has(canonicalComponentKey(id))) return null;
    let handler = handlers.get(id);
    if (!handler) {
      handler = () => activateComponentLink(host, id);
      handlers.set(id, handler);
    }
    return handler;
  };
}

function _sectionTarget(yaml: string, id: string) {
  const direct = findAddedSection(yaml, id, undefined);
  if (direct) return direct;
  const alias = platformKeyAlias(id);
  return alias ? findAddedSection(yaml, alias, undefined) : null;
}
