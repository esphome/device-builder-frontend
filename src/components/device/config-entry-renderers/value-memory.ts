import type { ReactiveControllerHost } from "lit";

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
 * the form's values yet: a unit picked on an empty field and the text of a
 * number being typed, both keyed by dotted path. ``RenderCtx`` documents
 * the calls.
 */
export class ValueMemory {
  private readonly _units = new Map<string, string>();

  private readonly _magnitudes = new Map<string, string>();

  /** The maps, for what renumbers the rows of a list. */
  readonly stores = [this._units, this._magnitudes];

  readonly ctx: ValueMemoryCtx = {
    getPendingUnit: (path) => this._units.get(path.join(".")),
    setPendingUnit: (path, unit) => {
      this._units.set(path.join("."), unit);
      // A unit-only pick doesn't reach the form's value-change cycle, no
      // emit happens, so the picker needs the explicit re-render.
      this._host.requestUpdate();
    },
    getEditingMagnitude: (path) => this._magnitudes.get(path.join(".")),
    setEditingMagnitude: (path, text) => {
      // No re-render: the @input handler that calls this also emits a
      // value-change, which re-renders the form through the owner's value
      // update. One here would double the work on every keystroke.
      this._magnitudes.set(path.join("."), text);
    },
    clearEditingMagnitude: (path) => {
      this._magnitudes.delete(path.join("."));
    },
  };

  constructor(private readonly _host: ReactiveControllerHost) {}

  clear(): void {
    this._units.clear();
    this._magnitudes.clear();
  }
}
