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
   *  so the caller stays put. */
  async onSave(): Promise<void> {
    const a = this._active;
    this._active = null;
    if (!a) return;
    a.resolve(await a.save());
  }

  /** Dialog "Cancel" / dismiss → resolve ``false`` so the caller
   *  drops its action. */
  onCancel(): void {
    const a = this._active;
    this._active = null;
    a?.resolve(false);
  }

  /** Resolve any in-flight guard as "don't proceed". Used on
   *  page disconnect so awaiters don't dangle past unmount. */
  cancelPending(): void {
    const a = this._active;
    this._active = null;
    a?.resolve(false);
  }

  /** Test/debug introspection: is a guard currently waiting? */
  get isPending(): boolean {
    return this._active !== null;
  }
}
