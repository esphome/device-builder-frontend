import type { ComponentCatalogEntry } from "../../api/types.js";
import type { ESPHomeAPI } from "../../api/index.js";

/** Slice of ``ESPHomeAddComponentDialog`` state ``navigateToDep`` reads / writes. */
export interface DepNavHost {
  readonly _api: ESPHomeAPI;
  platform: string;
  board: { id: string } | null;
  _catalog: { filterByDomain(domain: string): void } | null;
  _selected: ComponentCatalogEntry | null;
  _returnTo: ComponentCatalogEntry | null;
  _depDomain: string | null;
  _submitError: string;
  _submitting: boolean;
  _depNavSeq: number;
  readonly updateComplete: Promise<boolean>;
}

/**
 * Open the form for a missing dependency. Exact-id deps (``i2c``,
 * ``uart``) retarget directly; the catalog's fuzzy search would
 * rank every sensor mentioning the bus name above the bus entry.
 * Domain-level deps (``output``, ``sensor``) fall back to the
 * category-filtered catalog where the user picks a variant.
 */
export async function navigateToDep(
  host: DepNavHost,
  domain: string,
): Promise<void> {
  if (host._submitting) return;
  // Snapshot, don't commit, until the lookup resolves: the original
  // form is still rendered + submit-enabled (request-add-component
  // path), so a set _returnTo would mislead _onFormSubmit.
  const previousSelected = host._selected;
  host._submitError = "";
  const seq = ++host._depNavSeq;
  let direct: ComponentCatalogEntry | null = null;
  try {
    direct = await host._api.getComponent(
      domain,
      host.platform || undefined,
      host.board?.id ?? undefined,
    );
  } catch {
    direct = null;
  }
  if (seq !== host._depNavSeq) return;
  if (previousSelected) {
    host._returnTo = previousSelected;
    host._depDomain = domain;
  }
  if (direct) {
    host._selected = direct;
    return;
  }
  host._selected = null;
  await host.updateComplete;
  if (seq !== host._depNavSeq) return;
  host._catalog?.filterByDomain(domain);
}

/**
 * True when *added* is the component the user navigated to via
 * ``navigateToDep(depDomain)`` — matching by exact id for top-level
 * deps (``i2c``) or by category for domain-level deps (``output``).
 */
export function matchesDepDomain(
  added: ComponentCatalogEntry,
  depDomain: string,
): boolean {
  return added.id === depDomain || added.category === depDomain;
}
