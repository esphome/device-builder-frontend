import type { BoardCatalogEntry } from "../../api/types/boards.js";
import type { ConfigEntry, RequiredGroup } from "../../api/types/config-entries.js";
import { isEntryVisible } from "../../util/config-validation.js";
import {
  buildFormRenderPlan,
  planNeedsUserInput,
  unitAllAdvanced,
} from "./config-entry-form-plan.js";
import {
  collectRenderablePaths,
  renderFilterOptions,
  type RenderFilterOptions,
} from "./config-entry-render-filter.js";
import { collectUnsatisfiedConstraints } from "./config-entry-renderers/constraint-banners.js";
import {
  buildConstraintClusters,
  clusterRulesMet,
  isRadioCluster,
} from "./config-entry-renderers/constraint-cluster.js";

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

/** The ``keys`` an unmet banner carries when the form paints one of its members. */
const ACTIONABLE = "actionable";

/**
 * The add form's unmet constraint banners. Each one's ``keys`` is
 * ``ACTIONABLE`` when the form paints a member the user can set, else "".
 */
function unmetConstraints(
  entries: ConfigEntry[],
  values: Record<string, unknown>,
  requiredGroups: RequiredGroup[],
  board: BoardCatalogEntry | null,
  presentComponents: ReadonlySet<string>
) {
  const { memberKeys } = buildConstraintClusters(entries, requiredGroups);
  const painted = addFormRenderablePaths(
    entries,
    values,
    requiredGroups,
    board,
    presentComponents
  );
  // Pure-cardinality groups with no cluster box surface a banner only when
  // unsatisfied.
  return collectUnsatisfiedConstraints(
    {
      entries,
      requiredGroups,
      values,
      presentComponents,
      targetPlatform: board?.esphome.platform ?? null,
      formatKeys: (keys) => (keys.some((key) => painted.has(key)) ? ACTIONABLE : ""),
    },
    memberKeys
  );
}

/** The add form's visibility predicate for one of *entries*. */
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
    );
}

/**
 * Whether an unmet constraint should hold the Add button. Only one the user
 * can act on here counts: a member hidden by the required-only paint (an
 * advanced leaf, a NESTED block with no required children) must not leave
 * the component impossible to add.
 */
export function addFormHasUnsatisfiedConstraint(
  entries: ConfigEntry[],
  values: Record<string, unknown>,
  requiredGroups: RequiredGroup[],
  board: BoardCatalogEntry | null,
  presentComponents: ReadonlySet<string>
): boolean {
  const banner = unmetConstraints(
    entries,
    values,
    requiredGroups,
    board,
    presentComponents
  ).some((constraint) => constraint.keys === ACTIONABLE);
  if (banner) return true;
  // A static cluster box carries its own warning header instead of a banner.
  // Radios force a choice, and an all-advanced box has no toggle to reveal it.
  const isVisible = addFormVisibility(
    entries,
    values,
    addFormFilterOptions(values, board, presentComponents)
  );
  return buildConstraintClusters(entries, requiredGroups).clusters.some((cluster) => {
    if (isRadioCluster(cluster) || unitAllAdvanced(cluster.members)) return false;
    const { cardinalityOk, inclusiveOk } = clusterRulesMet(cluster, values);
    if (cardinalityOk && inclusiveOk) return false;
    return cluster.members.some((member) => !member.locked && isVisible(member));
  });
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
  const isVisible = addFormVisibility(entries, values, opts);
  if (planNeedsUserInput(plan, isVisible)) return true;
  // Any banner keeps the form open, actionable or not, so the user sees it.
  return (
    unmetConstraints(entries, values, requiredGroups, board, presentComponents).length > 0
  );
}
