import type { ReactiveController, ReactiveControllerHost } from "lit";
import { fieldKeyAttr, parseFieldKey } from "./config-entry-renderers-shared.js";
import { decideFieldFocus } from "./field-interaction.js";

// ``pointerdown`` is load-bearing: ``wa-input``'s nested ``delegatesFocus``
// keeps ``document.activeElement`` on the outer host, so ``focusin`` fires
// only on first entry, not when moving between fields.
const FIELD_INTERACTION_EVENTS = ["focusin", "pointerdown", "input", "change"] as const;

type FieldFocusHost = ReactiveControllerHost & HTMLElement;

/** Emits a bubbling ``field-focus`` event as the user moves between fields
 *  (emit/skip decided by ``decideFieldFocus``), for the YAML highlight sync. */
export class FieldFocusController implements ReactiveController {
  /** Field currently being edited (last ``focusin`` / ``input`` / pointer). */
  private _focusedKey?: string;

  constructor(private readonly host: FieldFocusHost) {
    host.addController(this);
  }

  hostConnected(): void {
    for (const t of FIELD_INTERACTION_EVENTS) {
      this.host.addEventListener(t, this._onInteraction);
    }
  }

  hostDisconnected(): void {
    for (const t of FIELD_INTERACTION_EVENTS) {
      this.host.removeEventListener(t, this._onInteraction);
    }
  }

  private _onInteraction = (e: Event) => {
    const el = e
      .composedPath()
      .find(
        (n): n is HTMLElement =>
          n instanceof HTMLElement && n.hasAttribute("data-field-key")
      );
    if (!el) return;
    // Only real field paths (JSON arrays from ``fieldKeyAttr``) map to a YAML
    // line. Synthetic disclosure keys like ``pin:pin-advanced`` would strand
    // the page in a doomed pending-field-line retry — skip them.
    const attr = el.getAttribute("data-field-key") ?? "";
    if (!attr.startsWith("[")) return;
    const path = parseFieldKey(attr);
    if (!path.length) return;
    const { emit, focusedKey } = decideFieldFocus(
      e.type,
      fieldKeyAttr(path),
      this._focusedKey
    );
    this._focusedKey = focusedKey;
    if (!emit) return;
    this.host.dispatchEvent(
      new CustomEvent<{ path: string[] }>("field-focus", {
        detail: { path },
        bubbles: true,
        composed: true,
      })
    );
  };
}
