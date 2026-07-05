/**
 * Shared DOM helpers for the happy-dom test suites.
 *
 * Nearly every component/dialog test used to hand-roll the same snippets:
 * an async mount (append + settle), a render-into-a-container helper for
 * pure template functions, and an identity localize stub for host fakes.
 * They live here once instead; ``test/_setup-dom.ts`` owns the matching
 * ``document.body`` cleanup between tests.
 */
import { render } from "lit";

/**
 * Append ``el`` to ``document.body`` and wait for its first render.
 *
 * ``props`` is ``Object.assign``ed onto the element before it is attached,
 * for suites that seed public props or private state ahead of the initial
 * update. Constrained to ``HTMLElement`` (not ``LitElement``) so plain
 * elements mount too; ``updateComplete`` is awaited when the element has
 * one (every Lit element) and is a no-op await otherwise.
 */
export async function mount<T extends HTMLElement>(
  el: T,
  props?: Partial<T>
): Promise<T> {
  if (props) {
    Object.assign(el, props);
  }
  document.body.appendChild(el);
  await (el as { updateComplete?: Promise<unknown> }).updateComplete;
  return el;
}

/**
 * Render a template into a fresh ``<div>`` attached to ``document.body``
 * and return the container.
 *
 * Takes ``unknown`` (mirroring lit's own ``render`` signature) so pure
 * renderers that return ``TemplateResult | typeof nothing`` pass without
 * a cast. The container is left attached; the global body cleanup in
 * ``test/_setup-dom.ts`` removes it between tests.
 */
export function renderInto(tpl: unknown): HTMLElement {
  const container = document.createElement("div");
  render(tpl, container);
  document.body.appendChild(container);
  return container;
}

/** Identity localize stub for host fakes: returns the key unchanged. */
export const identityLocalize = (key: string): string => key;
