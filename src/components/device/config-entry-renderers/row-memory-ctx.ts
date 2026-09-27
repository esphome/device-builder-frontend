import type { RenderCtx } from "../config-entry-renderers-types.js";
import type { ConstraintClusterController } from "../constraint-cluster-controller.js";
import { rekeyEnableStash } from "./nested.js";
import { fieldKeyRowRekeyer, rekeyStore, rowRekeyer } from "./row-memory.js";
import { rekeyTemplatableStash } from "./templatable.js";

/**
 * The form's side of ``row-memory``: the context call a list renderer makes
 * when its rows move, applied to every place the form remembers something
 * by field path. *fieldKeyStore* is keyed by ``fieldKeyAttr``, the *stores*
 * by dotted path.
 */
export function rowMemoryCtx(
  owner: object,
  clusters: ConstraintClusterController,
  fieldKeyStore: Set<string>,
  stores: (Map<string, unknown> | Set<string>)[]
): Pick<RenderCtx, "rowsMoved"> {
  return {
    rowsMoved: (path, move) => {
      const rekey = rowRekeyer(path, move);
      rekeyStore(fieldKeyStore, fieldKeyRowRekeyer(path, move));
      for (const store of stores) rekeyStore(store, rekey);
      rekeyTemplatableStash(owner, rekey);
      rekeyEnableStash(owner, rekey);
      clusters.rekeyChoices(rekey);
    },
  };
}
