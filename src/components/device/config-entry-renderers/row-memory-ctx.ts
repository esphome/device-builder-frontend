import type { RenderCtx } from "../config-entry-renderers-types.js";
import type { ConstraintClusterController } from "../constraint-cluster-controller.js";
import { PIN_ADVANCED_SUFFIX } from "../pin/wiring.js";
import { rekeyEnableStash } from "./nested.js";
import { fieldKeyRowRekeyer, rekeyStore, rowRekeyer } from "./row-memory.js";
import { rekeyTemplatableStash } from "./templatable.js";

/** Close every pin's Advanced panel in *stores*, the form's open groups
 *  and the marks of the ones it opened on its own. */
export function closePinAdvanced(...stores: Set<string>[]): void {
  for (const store of stores) {
    rekeyStore(store, (key) => (key.endsWith(PIN_ADVANCED_SUFFIX) ? null : key));
  }
}

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
