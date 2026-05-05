/**
 * Reusable "are you sure you want to leave unsaved work" gate.
 *
 * The device page funnels two distinct dirty-state guards through
 * one dialog: the YAML-buffer page-leave guard and the
 * section-form section-switch guard. Both follow the same
 * Discard / Save / Cancel pattern with the same modal; the only
 * differences are *what counts as dirty* and *how to save*. This
 * class owns the pending-resolver bookkeeping and exposes the
 * three dialog-event handlers, leaving the page free to wire its
 * specific dirty checks and save-fns.
 *
 * Held outside the Lit component so the logic is unit-testable
 * in node without happy-dom — instantiate one, drive its event
 * handlers, observe what the resolver Promise produces.
 */

export interface UnsavedGuardOptions {
  /** Snapshot of the dirty state at the call site. ``false`` →
   *  the helper resolves ``true`` immediately without opening
   *  the dialog. */
  dirty: boolean;
  /** Open the modal. Called only when ``dirty`` is true; the
   *  caller is expected to wire the dialog's
   *  ``discard`` / ``save`` / ``cancel`` events into the matching
   *  handler methods on this guard. */
  open: () => void;
  /** Performs the save. Returns ``true`` when the save actually
   *  succeeded (so the buffer is clean afterwards), ``false``
   *  otherwise — callers shouldn't proceed past a failed save. */
  save: () => Promise<boolean>;
}

export class UnsavedGuard {
  private _active: {
    save: () => Promise<boolean>;
    resolve: (proceed: boolean) => void;
  } | null = null;

  /** Open the dialog (if dirty) and resolve once the user picks.
   *
   *  - Not dirty → resolves ``true`` immediately, dialog stays
   *    closed.
   *  - Dirty + no other guard pending → opens the dialog, resolves
   *    once a handler fires.
   *  - Dirty + already-pending guard → resolves ``false``. Two
   *    overlapping prompts make no sense; the second caller
   *    silently drops its action rather than stacking dialogs. */
  run(opts: UnsavedGuardOptions): Promise<boolean> {
    if (!opts.dirty) return Promise.resolve(true);
    if (this._active) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      this._active = { save: opts.save, resolve };
      opts.open();
    });
  }

  /** Dialog "Discard" → proceed (resolve ``true``). */
  onDiscard(): void {
    const a = this._active;
    this._active = null;
    a?.resolve(true);
  }

  /** Dialog "Save and leave" → run the saver, proceed iff it
   *  succeeded. The saver's return value is the source of truth:
   *  validation errors / IO failures should resolve to ``false``
   *  so the caller stays put.
   *
   *  Wraps the await in try/catch so a saver that *throws*
   *  (network error, programmer mistake) still resolves the
   *  guard Promise. Without this, an in-flight ``run()`` would
   *  dangle forever — the caller's ``await`` never returns and
   *  the dialog can't be re-opened (``isPending`` stays stale). */
  async onSave(): Promise<void> {
    const a = this._active;
    this._active = null;
    if (!a) return;
    let ok = false;
    try {
      ok = await a.save();
    } catch {
      ok = false;
    }
    a.resolve(ok);
  }

  /** Dialog "Cancel" / dismiss, *and* the page-disconnect
   *  cleanup path — both want the same "resolve any in-flight
   *  guard as don't-proceed" behaviour, so they share one
   *  implementation. The two call sites are named differently
   *  in the page (``_onUnsavedCancel`` for the dialog event,
   *  ``cancelPending`` for unmount) but funnel through here. */
  onCancel(): void {
    const a = this._active;
    this._active = null;
    a?.resolve(false);
  }

  /** Alias — same behaviour as :meth:`onCancel`, kept for the
   *  page's ``disconnectedCallback`` to read clearly at the
   *  call site (``cancelPending`` vs ``onCancel`` carries
   *  different intent even though the implementation is one
   *  thing). */
  cancelPending = this.onCancel;

  /** Test/debug introspection: is a guard currently waiting? */
  get isPending(): boolean {
    return this._active !== null;
  }
}
