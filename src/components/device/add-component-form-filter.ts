import type { BoardCatalogEntry } from "../../api/types/boards.js";
import type { ConfigEntry, RequiredGroup } from "../../api/types/config-entries.js";
import { buildFormRenderPlan, planNeedsUserInput } from "./config-entry-form-plan.js";
import {
  collectRenderablePaths,
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
  const plan = buildFormRenderPlan(
    entries,
    values,
    requiredGroups,
    addFormFilterOptions(values, board, presentComponents)
  );
  // Any unmet prompt keeps the form open, actionable or not, so the user sees it.
  return planNeedsUserInput(plan) || plan.unmet.length > 0;
}
