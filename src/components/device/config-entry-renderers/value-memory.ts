import type { RenderCtx } from "../config-entry-renderers-types.js";

type ValueMemoryCtx = Pick<
  RenderCtx,
  | "clearEditingMagnitude"
  | "getEditingMagnitude"
  | "getPendingUnit"
  | "setEditingMagnitude"
  | "setPendingUnit"
>;

/**
 * What a form holds of a value the user has started on and that is not in
 * the form's values yet. Both maps are keyed by dotted path. They are
 * dropped when the form shows other entries, and when the values were read
 * again from a YAML edited outside the form.
 */
export class ValueMemory {
  /**
   * Transient unit choice for FLOAT_WITH_UNIT entries the user picked
   * before typing a numeric value. `chooseDisplayUnit` reads this layer
   * before falling back to the catalog default, so the picker survives a
   * rerender even when the form value is still `""`. Superseded once a
   * non-empty `parsed.unit` from the form value beats the pending layer.
   */
  readonly units = new Map<string, string>();

  /**
   * Transient raw-text buffer for FLOAT_WITH_UNIT magnitude inputs.
   * `<input type="number">` reads `""` from `.value` for mid-typing
   * intermediates (`"-"`, `"1e"`, `"1."`); Lit's `.value=` property
   * binding then re-writes `""` over the partial text. The renderer reads
   * from this buffer first so partial input survives until the user
   * produces a parseable value (which lands in the form's values
   * normally) or blurs.
   */
  readonly magnitudes = new Map<string, string>();

  clear(): void {
    this.units.clear();
    this.magnitudes.clear();
  }

  /** The render context's side of the memory, for a form that re-renders
   *  through *requestUpdate*. */
  ctx(requestUpdate: () => void): ValueMemoryCtx {
    return {
      getPendingUnit: (path) => this.units.get(path.join(".")),
      setPendingUnit: (path, unit) => {
        this.units.set(path.join("."), unit);
        // A unit-only pick doesn't reach the form's value-change cycle, no
        // emit happens, so the picker needs the explicit re-render.
        requestUpdate();
      },
      getEditingMagnitude: (path) => this.magnitudes.get(path.join(".")),
      setEditingMagnitude: (path, text) => {
        // No re-render: the @input handler that calls this also emits a
        // value-change, which re-renders the form through the owner's
        // value update. One here would double the work on every keystroke.
        this.magnitudes.set(path.join("."), text);
      },
      clearEditingMagnitude: (path) => {
        this.magnitudes.delete(path.join("."));
      },
    };
  }
}
