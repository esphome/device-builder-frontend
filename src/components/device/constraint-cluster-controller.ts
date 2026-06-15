import type { ReactiveController, ReactiveControllerHost } from "lit";

interface RadioGroupElement extends HTMLElement {
  syncRadioElements?: () => void | Promise<void>;
  updateComplete?: Promise<unknown>;
}

type Host = ReactiveControllerHost & { shadowRoot: ShadowRoot | null };

/**
 * Off-config UI state for either/or constraint clusters (the radio chooser):
 * the selected alternative per cluster and the stashed values of the deselected
 * side so switching back restores them (only the selected side is serialized).
 * Also forces each `<wa-radio-group>` to reflect its value after render —
 * webawesome's custom `value` setter never triggers the group's own
 * `syncRadioElements`, the same first-paint gap `_syncSelectValues` handles for
 * `<wa-select>`. Kept off the form element so config-entry-form.ts doesn't grow.
 */
export class ConstraintClusterController implements ReactiveController {
  private _choices = new Map<string, string>();

  private _stash = new Map<string, unknown>();

  constructor(private _host: Host) {
    _host.addController(this);
  }

  hostUpdated(): void {
    void this._syncRadioGroups();
  }

  /** Drop choices/stash when the form is re-targeted to a different component. */
  reset(): void {
    this._choices.clear();
    this._stash.clear();
  }

  getChoice(clusterId: string): string | undefined {
    return this._choices.get(clusterId);
  }

  setChoice(clusterId: string, altId: string): void {
    this._choices.set(clusterId, altId);
    // Not a @state field, so re-render explicitly to reflect the pick.
    this._host.requestUpdate();
  }

  getStash(clusterId: string, key: string): unknown {
    return this._stash.get(`${clusterId} ${key}`);
  }

  setStash(clusterId: string, key: string, value: unknown): void {
    this._stash.set(`${clusterId} ${key}`, value);
  }

  clearStash(clusterId: string, key: string): void {
    this._stash.delete(`${clusterId} ${key}`);
  }

  private async _syncRadioGroups(): Promise<void> {
    const root = this._host.shadowRoot;
    if (!root) return;
    const groups = [...root.querySelectorAll<RadioGroupElement>("wa-radio-group")];
    if (groups.length === 0) return;
    // Await each group's update together (not serially) so the forced sync
    // reflects the latest value. The `.catch(() => {})` swallows a rejection on
    // purpose: a group that failed to settle just isn't ready, so we sync the
    // ones that are and let the next render recover, rather than aborting the
    // whole pass (don't "fix" this into a throw).
    await Promise.all(groups.map((group) => group.updateComplete?.catch(() => {})));
    for (const group of groups) group.syncRadioElements?.();
  }
}
