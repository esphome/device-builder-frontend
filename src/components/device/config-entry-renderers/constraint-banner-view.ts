import { html, nothing } from "lit";
import type { ConfigEntry, RequiredGroup } from "../../../api/types/config-entries.js";
import type { RenderCtx } from "../config-entry-renderers-shared.js";
import { collectUnsatisfiedConstraints } from "./constraint-banners.js";
import { formatConstraintKeys } from "./constraint-cluster.js";

/** One scope's constraint inputs: the form root, or a nested block in use. */
export interface ConstraintScope {
  entries: ConfigEntry[];
  requiredGroups: RequiredGroup[];
  values: Record<string, unknown>;
}

/** A warning banner per unmet constraint of *scope* that no cluster box carries. */
export function renderConstraintBanners(
  scope: ConstraintScope,
  clusteredKeys: Set<string>,
  ctx: RenderCtx
) {
  const unsatisfied = collectUnsatisfiedConstraints(
    {
      ...scope,
      presentComponents: ctx.presentComponents,
      targetPlatform: ctx.board?.esphome.platform ?? null,
      formatKeys: (keys) => formatConstraintKeys(keys, scope.entries, ctx),
    },
    clusteredKeys
  );
  if (unsatisfied.length === 0) return nothing;
  return unsatisfied.map(
    ({ kind, keys }) => html`
      <div class="warning-banner constraint-banner">
        <wa-icon library="mdi" name="alert-circle-outline"></wa-icon>
        <span>${ctx.localize(`device.constraint_${kind}`, { keys })}</span>
      </div>
    `
  );
}
