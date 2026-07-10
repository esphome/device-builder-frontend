import type { BoardCatalogEntry } from "../../api/types/boards.js";
import type { ConfigEntry, RequiredGroup } from "../../api/types/config-entries.js";
import { isEntryVisible } from "../../util/config-validation.js";
import { buildFormRenderPlan, planNeedsUserInput } from "./config-entry-form-plan.js";
import {
  collectRenderablePaths,
  renderFilterOptions,
  type RenderFilterOptions,
} from "./config-entry-render-filter.js";
import { collectUnsatisfiedConstraints } from "./config-entry-renderers/constraint-banners.js";

/**
 * The add-component form's fixed render filter: required-only, no advanced
 * toggle (the inner config-entry form is always mounted `required-only` and
 * the add-form never exposes a show-advanced toggle). Routes through
 * `renderFilterOptions` so the `board`→`targetPlatform` derivation stays in
 * lockstep with the form's own paint.
 */
function addFormFilterOptions(
  values: Record<string, unknown>,
  board: BoardCatalogEntry | null,
  presentComponents: ReadonlySet<string>
): RenderFilterOptions {
  return renderFilterOptions({
    requiredOnly: true,
    showAdvanced: false,
    presentComponents,
    board,
    values,
  });
}

/**
 * Dotted paths the add-component form would paint for *entries* under its
 * fixed filter. The form's error-visibility check reads it so a validation
 * error on a hidden field doesn't bail the submit silently.
 */
export function addFormRenderablePaths(
  entries: ConfigEntry[],
  values: Record<string, unknown>,
  board: BoardCatalogEntry | null,
  presentComponents: ReadonlySet<string>
): Set<string> {
  return collectRenderablePaths(
    entries,
    values,
    addFormFilterOptions(values, board, presentComponents)
  );
}

/**
 * Whether the add-component form would paint anything the user must engage
 * with: an unlocked plain field, an exclusive-group dropdown, a
 * constraint-cluster box, or an unsatisfied-constraint banner. Built on the
 * same `buildFormRenderPlan` the form's `render()` uses, so the dialog's
 * skip-the-form gate can't drift from the actual paint. `false` means the form
 * would be a dead-end (blank, or only board-locked read-only fields) and the
 * caller should add the component without showing it.
 */
export function addFormNeedsUserInput(
  entries: ConfigEntry[],
  values: Record<string, unknown>,
  requiredGroups: RequiredGroup[],
  board: BoardCatalogEntry | null,
  presentComponents: ReadonlySet<string>
): boolean {
  const opts = addFormFilterOptions(values, board, presentComponents);
  const plan = buildFormRenderPlan(entries, values, requiredGroups, opts);
  // Group/cluster members are unfiltered in the plan; gate them on the same
  // visibility the form uses so a hidden unlocked member can't keep the form
  // open when every rendered field is board-locked.
  const isVisible = (entry: ConfigEntry): boolean =>
    isEntryVisible(
      entry,
      values,
      opts.presentComponents,
      opts.targetPlatform ?? null,
      opts.rootValues
    );
  if (planNeedsUserInput(plan, isVisible)) return true;
  // Pure-cardinality groups with no cluster box surface a banner only when
  // unsatisfied; keys are irrelevant to presence, so format to "".
  return (
    collectUnsatisfiedConstraints(
      {
        entries,
        requiredGroups,
        values,
        presentComponents,
        targetPlatform: opts.targetPlatform ?? null,
        formatKeys: () => "",
      },
      plan.memberKeys
    ).length > 0
  );
}
