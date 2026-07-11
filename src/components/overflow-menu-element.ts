import { LitElement } from "lit";
import { state } from "lit/decorators.js";
import { EscapeController } from "../util/escape-controller.js";

/**
 * Base for self-triggering kebab / toggle popover menus: owns the open
 * flag, Escape-to-close, keyboard activation of focusable menu rows, and
 * bubbling-event emit.
 *
 * Subclasses render their own trigger button, menu body, and styles (pairing
 * `dropdownMenuStyles`), wiring `_toggle`/`_close` on the trigger/backdrop,
 * `_onItemKeydown` on focusable rows, and `_emit` for actions. Override
 * `willUpdate` only if you also `super.willUpdate(changed)`.
 *
 * Not for externally-positioned context menus whose open state derives from
 * props and whose close has side effects (see `table-row-menu`).
 */
export abstract class OverflowMenuElement extends LitElement {
  @state() protected _open = false;

  private _escape = new EscapeController(this, (e) => {
    e.preventDefault();
    this._close();
  });

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has("_open")) this._escape.set(this._open);
  }

  protected _toggle = () => {
    this._open = !this._open;
  };

  protected _close = () => {
    this._open = false;
  };

  /**
   * Enter/Space activates a focusable row, re-dispatching its `@click`. Rows
   * are role'd divs (`menuitem` / `menuitemcheckbox`), not `<button>`s, so they
   * sit flush with the checkbox / icon-label styling; this restores the
   * keyboard path buttons would give for free.
   */
  protected _onItemKeydown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      (e.currentTarget as HTMLElement).click();
    }
  };

  protected _emit(type: string, detail?: unknown) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
}
