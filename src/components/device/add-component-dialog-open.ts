import type { FeaturedComponent } from "../../api/types/boards.js";
import type { ComponentCatalogEntry } from "../../api/types/components.js";
import { collectExistingIds } from "../../util/default-component-id.js";
import { buildFeaturedId, isFeaturedId } from "../../util/featured-id.js";
import {
  hydrateForSelection,
  type SelectionHost,
  type SelectionResult,
} from "./add-component-dialog-selection.js";

/** Slice of ``ESPHomeAddComponentDialog`` state the selection-apply
 *  and open-by-id paths read / write. */
export interface OpenComponentHost extends SelectionHost {
  yaml: string;
  board: { id: string; featured_components?: FeaturedComponent[] } | null;
  _selected: ComponentCatalogEntry | null;
  _submitError: string;
  open(): void;
  _startFeaturedSequence(
    fullIds: string[],
    boardId: string,
    progressName: string
  ): Promise<boolean>;
  _fastPathFields(entry: ComponentCatalogEntry): Record<string, unknown> | null;
  _submitComponent(fields: Record<string, unknown>, notify?: boolean): Promise<void>;
}

/**
 * Land a hydrated selection: surface errors, queue featured
 * prerequisites, else open the form — or fast-path the add when the
 * form needs no user input.
 */
export async function applyHydratedSelection(
  host: OpenComponentHost,
  result: SelectionResult
): Promise<void> {
  if (result.kind === "stale") return;
  if (result.kind === "error") {
    host._submitError = result.message;
    return;
  }
  // A featured component can require hub(s)/a bus to exist first (a gpio pin
  // on a pcf8574 needs the pcf8574 + i2c). Add the missing prerequisites
  // ahead of it through the same sequential queue bundles use.
  const prereqs = missingRequiredPrereqs(host, result.entry);
  if (prereqs && prereqs.unresolved.length > 0) {
    // A declared prerequisite isn't in the catalog (a same-release catalog
    // bug). Refuse rather than add the component without its hub/bus and ship
    // the broken config this flow exists to prevent.
    host._submitError = host._localize("device.prereq_unresolved", {
      name: result.entry.name,
      ids: prereqs.unresolved.join(", "),
    });
    return;
  }
  if (prereqs && prereqs.missing.length > 0) {
    // The intermediate steps are the prerequisites (bus, hub), not the picked
    // component, so frame the banner as "Adding prerequisites for <name>".
    await host._startFeaturedSequence(
      [...prereqs.missing, result.entry.id],
      prereqs.boardId,
      host._localize("device.adding_prerequisites_for", { name: result.entry.name })
    );
    return;
  }
  host._selected = result.entry;
  host._submitError = "";
  const fields = host._fastPathFields(result.entry);
  if (fields) await host._submitComponent(fields, /* notify */ true);
}

/**
 * Open the dialog directly onto *id*'s add form (or fast-path the add
 * when it needs no input). The catalog still loads behind the form so
 * Back lands on it.
 */
export async function openComponentById(
  host: OpenComponentHost,
  id: string
): Promise<void> {
  host.open();
  const result = await hydrateForSelection(host, id);
  await applyHydratedSelection(host, result);
}

/**
 * The featured prerequisites a just-selected featured component still needs:
 * its `requires` local ids (bus then hub), resolved to full featured ids,
 * keeping only those whose locked id isn't already in the YAML. Returns null
 * for a non-featured entry or one with no requires.
 *
 * Invariant: `requires` must be the fully-flattened, ordered prerequisite set
 * — only the selected component's direct `requires` is resolved here, and the
 * queued items (added via `_startFeaturedSequence`) do NOT re-resolve their
 * own `requires`. The backend (esphome/device-builder#1717) emits the complete
 * chain (e.g. a gpio lists `[bus, hub]`, not just the hub).
 */
export function missingRequiredPrereqs(
  host: OpenComponentHost,
  entry: ComponentCatalogEntry
): { boardId: string; missing: string[]; unresolved: string[] } | null {
  const board = host.board;
  if (!board || !isFeaturedId(entry.id)) return null;
  const featured = board.featured_components ?? [];
  const fc = featured.find((c) => buildFeaturedId(board.id, c.id) === entry.id);
  if (!fc?.requires?.length) return null;
  const existingIds = collectExistingIds(host.yaml);
  const missing: string[] = [];
  const unresolved: string[] = [];
  for (const reqLocal of fc.requires) {
    const prereq = featured.find((c) => c.id === reqLocal);
    if (!prereq) {
      // A requires id with no matching featured component is a catalog bug in
      // this same (lockstep) release, not version drift: adding the component
      // without its prereq ships the broken hub-referencing config this flow
      // exists to prevent. Record it so the caller refuses the add (and warn
      // with the precise id for a developer).
      console.warn(
        `Featured component '${entry.id}' requires '${reqLocal}', which is not in the board catalog.`
      );
      unresolved.push(reqLocal);
      continue;
    }
    const presetId = prereq.fields.id?.value;
    if (typeof presetId === "string" && existingIds.has(presetId)) continue;
    missing.push(buildFeaturedId(board.id, reqLocal));
  }
  return { boardId: board.id, missing, unresolved };
}
