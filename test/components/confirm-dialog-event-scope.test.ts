// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";

import { ESPHomeConfirmDialog } from "../../src/components/confirm-dialog.js";

/**
 * Regression coverage for the shadow-DOM event-bubbling invariant
 * that ``esphome-confirm-dialog`` relies on: its ``confirm`` /
 * ``secondary`` / ``cancel`` events must NOT have ``composed: true``.
 *
 * History: the previous shape ``new CustomEvent("confirm", {bubbles:
 * true, composed: true})`` let the original inner event keep
 * bubbling past wrapper components like ``esphome-accept-peer-dialog``
 * — the wrapper re-dispatched its own enriched event under the same
 * name, AND the original event escaped the wrapper's shadow boundary
 * to reach the parent section's listener a second time. Symptom:
 * red "Couldn't approve" toast stacked on top of green "Sender
 * approved" on every receiver Accept click. A future change that
 * silently re-adds ``composed: true`` would re-introduce the bug;
 * these tests catch that.
 */

interface DialogPrivateView extends EventTarget {
  _decided: boolean;
  close: () => void;
  _confirm(): void;
  _secondary(): void;
  _onAfterHide(): void;
}

/** Build a confirm-dialog instance with ``close()`` stubbed so the
 *  production call inside ``_confirm`` / ``_secondary`` doesn't
 *  hit the ``@query`` wa-dialog reference (undefined without
 *  full DOM mount + wa-dialog registration). What we want to test
 *  is the ``dispatchEvent`` call shape, not the close path. */
function makeBareDialog(): DialogPrivateView {
  const dialog = new ESPHomeConfirmDialog() as unknown as DialogPrivateView;
  dialog.close = () => {};
  return dialog;
}

describe("esphome-confirm-dialog event composition", () => {
  test("confirm event is non-composed (won't escape parent shadow)", () => {
    const dialog = makeBareDialog();
    const captured: Event[] = [];
    dialog.addEventListener("confirm", (e) => captured.push(e));

    dialog._confirm();

    expect(captured).toHaveLength(1);
    expect(captured[0].bubbles).toBe(true);
    expect(captured[0].composed).toBe(false);
  });

  test("secondary event is non-composed", () => {
    const dialog = makeBareDialog();
    const captured: Event[] = [];
    dialog.addEventListener("secondary", (e) => captured.push(e));

    dialog._secondary();

    expect(captured).toHaveLength(1);
    expect(captured[0].bubbles).toBe(true);
    expect(captured[0].composed).toBe(false);
  });

  test("cancel event is non-composed", () => {
    const dialog = makeBareDialog();
    // _onAfterHide only fires the cancel event when _decided is false
    // (no button click landed before wa-dialog finished hiding).
    dialog._decided = false;
    const captured: Event[] = [];
    dialog.addEventListener("cancel", (e) => captured.push(e));

    dialog._onAfterHide();

    expect(captured).toHaveLength(1);
    expect(captured[0].bubbles).toBe(true);
    expect(captured[0].composed).toBe(false);
  });
});
