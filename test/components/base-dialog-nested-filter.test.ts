// @vitest-environment happy-dom
import { describe, expect, test, vi } from "vitest";

// Stub the real wa-dialog: happy-dom can't run its form-associated
// close button (reads ElementInternals.validity), and these tests only
// need the wrapper's own event wiring, not wa-dialog's internals.
vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));

import { ESPHomeBaseDialog } from "../../src/components/base-dialog.js";

/**
 * Regression coverage for ``esphome-base-dialog``'s nested-wa-dialog
 * leak filter. Web Awesome's ``wa-dialog`` fires
 * ``wa-after-hide`` / ``wa-hide`` with ``bubbles + composed``,
 * so a wa-dialog opened *inside* the slotted body of a base-dialog
 * (e.g. the receiver-side accept flow opening an
 * ``esphome-confirm-dialog`` while the Settings dialog is open) would
 * otherwise trigger the OUTER base-dialog's listeners and re-emit
 * ``after-hide``, making the outer dialog close itself. The filter
 * ``if (e.target !== e.currentTarget) return;`` keeps each
 * base-dialog wrapper scoped to its own wa-dialog.
 *
 * History (symptoms field-reported on PR #312):
 *
 * * Build server → Pairing requests → Accept closed Settings.
 * * Build server → Paired senders → Remove closed Settings.
 * * Send builds → Pair with a build server → Cancel closed Settings.
 *
 * All three shared this root cause. These tests pin the filter so a
 * future refactor of the listener can't silently drop it.
 */

interface BaseDialogPrivateView extends EventTarget {
  _onWaHide(e: Event): void;
  _onWaAfterHide(e: Event): void;
}

function makeBase(): BaseDialogPrivateView {
  return new ESPHomeBaseDialog() as unknown as BaseDialogPrivateView;
}

describe("esphome-base-dialog nested-wa-dialog filter", () => {
  test("wa-after-hide from a nested wa-dialog does not re-emit after-hide", () => {
    const base = makeBase();
    const reemits = vi.fn();
    base.addEventListener("after-hide", reemits);

    // Simulate a nested wa-dialog's wa-after-hide bubbling up: the
    // event's currentTarget is base-dialog's own wa-dialog (the
    // listener was attached there) but its target is the inner
    // descendant wa-dialog.
    const event = new Event("wa-after-hide", { bubbles: true });
    const ownWaDialog = document.createElement("wa-dialog");
    const nestedWaDialog = document.createElement("wa-dialog");
    Object.defineProperty(event, "currentTarget", {
      value: ownWaDialog,
      writable: false,
    });
    Object.defineProperty(event, "target", {
      value: nestedWaDialog,
      writable: false,
    });

    base._onWaAfterHide(event);

    expect(reemits).not.toHaveBeenCalled();
  });

  test("wa-after-hide from base-dialog's own wa-dialog re-emits after-hide", () => {
    const base = makeBase();
    const reemits = vi.fn();
    base.addEventListener("after-hide", reemits);

    // target === currentTarget — the event came from the wrapper's
    // own wa-dialog, not a nested one.
    const event = new Event("wa-after-hide", { bubbles: true });
    const ownWaDialog = document.createElement("wa-dialog");
    Object.defineProperty(event, "currentTarget", {
      value: ownWaDialog,
      writable: false,
    });
    Object.defineProperty(event, "target", {
      value: ownWaDialog,
      writable: false,
    });

    base._onWaAfterHide(event);

    expect(reemits).toHaveBeenCalledTimes(1);
  });

  test("wa-hide from a nested wa-dialog does not re-emit request-close", () => {
    const base = makeBase();
    const reemits = vi.fn();
    base.addEventListener("request-close", reemits);

    const event = new Event("wa-hide", {
      bubbles: true,
      cancelable: true,
    });
    const ownWaDialog = document.createElement("wa-dialog");
    const nestedWaDialog = document.createElement("wa-dialog");
    Object.defineProperty(event, "currentTarget", {
      value: ownWaDialog,
      writable: false,
    });
    Object.defineProperty(event, "target", {
      value: nestedWaDialog,
      writable: false,
    });

    base._onWaHide(event);

    expect(reemits).not.toHaveBeenCalled();
  });

  test("wa-hide from base-dialog's own wa-dialog re-emits request-close", () => {
    const base = makeBase();
    const reemits = vi.fn();
    base.addEventListener("request-close", reemits);

    const event = new Event("wa-hide", {
      bubbles: true,
      cancelable: true,
    });
    const ownWaDialog = document.createElement("wa-dialog");
    Object.defineProperty(event, "currentTarget", {
      value: ownWaDialog,
      writable: false,
    });
    Object.defineProperty(event, "target", {
      value: ownWaDialog,
      writable: false,
    });

    base._onWaHide(event);

    expect(reemits).toHaveBeenCalledTimes(1);
  });

  // Binding-level guard: the wrapper must listen for the event wa-dialog
  // actually fires (``wa-hide``), not the nonexistent ``wa-request-close``.
  // Dispatching the real event on the rendered wa-dialog must re-emit
  // request-close; a stale ``wa-request-close`` must not. Without this the
  // host never flips _open on a user close, so the dialog can't reopen.
  test("rendered wrapper re-emits request-close on its wa-dialog's wa-hide", async () => {
    const base = new ESPHomeBaseDialog();
    base.open = true;
    document.body.appendChild(base);
    await base.updateComplete;

    const wa = base.shadowRoot!.querySelector("wa-dialog")!;
    const reemits = vi.fn();
    base.addEventListener("request-close", reemits);

    wa.dispatchEvent(new Event("wa-request-close", { bubbles: true, cancelable: true }));
    expect(reemits).not.toHaveBeenCalled();

    wa.dispatchEvent(new Event("wa-hide", { bubbles: true, cancelable: true }));
    expect(reemits).toHaveBeenCalledTimes(1);

    base.remove();
  });
});
