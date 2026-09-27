import type { RenderCtx } from "../config-entry-renderers-types.js";
import type { ConstraintClusterController } from "../constraint-cluster-controller.js";
import { rekeyEnableStash } from "./nested.js";
import { type Rekey, rekeyStore, rowRekeyer } from "./row-memory.js";
import { rekeyTemplatableStash } from "./templatable.js";

/**
 * The form's side of ``row-memory``: the two context calls a list renderer
 * makes when a row leaves or changes kind, applied to every place the form
 * remembers something by field path.
 */
export function rowMemoryCtx(
  owner: object,
  clusters: ConstraintClusterController,
  stores: (Map<string, unknown> | Set<string>)[]
): Pick<RenderCtx, "rowKindChanged" | "rowRemoved"> {
  const forget = (rekey: Rekey) => {
    for (const store of stores) rekeyStore(store, rekey);
    rekeyTemplatableStash(owner, rekey);
    rekeyEnableStash(owner, rekey);
    clusters.rekeyChoices(rekey);
  };
  return {
    rowRemoved: (path, index) => forget(rowRekeyer(path, index)),
    // The row stays where it is, so nothing moves: only its own keys go.
    rowKindChanged: (path, index) => {
      const rekey = rowRekeyer(path, index);
      forget((key) => (rekey(key) === null ? null : key));
    },
  };
}
