import { flushMicrotasks } from "../../_dom.js";
import type { ESPHomeAPI } from "../../../src/api/index.js";
import type { BoardCatalogEntry } from "../../../src/api/types/boards.js";
import type { ComponentCatalogEntry } from "../../../src/api/types/components.js";
import { ESPHomeAddComponentForm } from "../../../src/components/device/add-component-form.js";

export interface AddComponentFormOptions {
  component: ComponentCatalogEntry;
  /** Stub API injected as the form's `_api`. */
  api: ESPHomeAPI;
  yaml?: string;
  board?: BoardCatalogEntry | null;
  resolvedComponents?: readonly string[];
}

/**
 * A form wired to a stub API, constructed but not mounted.
 *
 * Callers must still `vi.mock` the icon (and `config-entry-form` where
 * the suite renders the inner form) at module scope: those run before
 * the import, so they can't live here.
 */
export function makeAddComponentForm(
  options: AddComponentFormOptions
): ESPHomeAddComponentForm {
  const el = new ESPHomeAddComponentForm();
  el.component = options.component;
  if (options.yaml !== undefined) el.yaml = options.yaml;
  if (options.board !== undefined) el.board = options.board;
  if (options.resolvedComponents !== undefined)
    el.resolvedComponents = options.resolvedComponents;
  Object.assign(el as unknown as Record<string, unknown>, { _api: options.api });
  return el;
}

/** Mount the form and let its async dependency lookups settle. */
export async function mountAddComponentForm(
  options: AddComponentFormOptions
): Promise<ESPHomeAddComponentForm> {
  const el = makeAddComponentForm(options);
  document.body.appendChild(el);
  // The first paint shows the literal-missing banner; once the async
  // provides lookup settles (a few microtask hops through the cache), a
  // re-render clears it. Flush generously, then await the final update.
  await el.updateComplete;
  await flushMicrotasks(10);
  await el.updateComplete;
  return el;
}

/** The missing-deps warning banner, or null once cleared. */
export function depsBanner(el: ESPHomeAddComponentForm): Element | null {
  return el.shadowRoot!.querySelector(".deps-warning");
}

/** The primary Submit button. */
export function submitButton(el: ESPHomeAddComponentForm): HTMLButtonElement {
  return el.shadowRoot!.querySelector<HTMLButtonElement>(".btn-primary")!;
}
