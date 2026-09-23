import { html, nothing } from "lit";
import type { ConfigEntry } from "../../../api/types/config-entries.js";
import type { RenderCtx } from "../config-entry-renderers-shared.js";
import type { UnsatisfiedConstraint } from "./constraint-banners.js";
import { formatConstraintKeys } from "./constraint-cluster.js";

/** A warning banner per prompt, its keys labelled against *entries*. */
export function renderConstraintBanners(
  prompts: readonly UnsatisfiedConstraint[],
  entries: ConfigEntry[],
  ctx: RenderCtx
) {
  if (prompts.length === 0) return nothing;
  return prompts.map(
    ({ kind, keys }) => html`
      <div class="warning-banner constraint-banner">
        <wa-icon library="mdi" name="alert-circle-outline"></wa-icon>
        <span>
          ${ctx.localize(`device.constraint_${kind}`, {
            keys: formatConstraintKeys(keys, entries, ctx),
          })}
        </span>
      </div>
    `
  );
}
