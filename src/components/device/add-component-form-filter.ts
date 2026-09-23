import type { BoardCatalogEntry } from "../../api/types/boards.js";
import type { ConfigEntry, RequiredGroup } from "../../api/types/config-entries.js";
import { isEntryVisible } from "../../util/config-validation.js";
import { buildFormRenderPlan, planNeedsUserInput } from "./config-entry-form-plan.js";
import {
  collectRenderablePaths,
  isEmptyBlock,
  renderFilterOptions,
  type RenderFilterOptions,
} from "./config-entry-render-filter.js";

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
  requiredGroups: RequiredGroup[],
  board: BoardCatalogEntry | null,
  presentComponents: ReadonlySet<string>
): Set<string> {
  return collectRenderablePaths(entries, values, {
    ...addFormFilterOptions(values, board, presentComponents),
    requiredGroups,
  });
}

function addFormVisibility(
  entries: ConfigEntry[],
  values: Record<string, unknown>,
  opts: RenderFilterOptions
): (entry: ConfigEntry) => boolean {
  return (entry) =>
    isEntryVisible(
      entry,
      values,
      opts.presentComponents,
      opts.targetPlatform ?? null,
      opts.rootValues,
      entries
      // An exclusive-group member paints as a dropdown option whatever it holds.
    ) &&
    (Boolean(entry.exclusive_group) || !isEmptyBlock(entry, values, opts));
}

/**
 * Whether an unmet constraint should hold the Add button. Only one the user
 * can act on here counts: a member the required-only paint drops (an
 * advanced leaf, a NESTED block with no field and nothing for its enable
 * switch to write) must not leave the component impossible to add.
 */
export function addFormHasUnsatisfiedConstraint(
  entries: ConfigEntry[],
  values: Record<string, unknown>,
  requiredGroups: RequiredGroup[],
  board: BoardCatalogEntry | null,
  presentComponents: ReadonlySet<string>
): boolean {
  return buildFormRenderPlan(
    entries,
    values,
    requiredGroups,
    addFormFilterOptions(values, board, presentComponents)
  ).unmet.some((constraint) => constraint.actionable);
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
  // Exclusive-group members are unfiltered in the plan; gate them on the same
  // visibility the form uses so a hidden unlocked member can't keep the form
  // open when every rendered field is board-locked.
  const isVisible = addFormVisibility(entries, values, { ...opts, requiredGroups });
  // Any unmet prompt keeps the form open, actionable or not, so the user sees it.
  return planNeedsUserInput(plan, isVisible) || plan.unmet.length > 0;
}
