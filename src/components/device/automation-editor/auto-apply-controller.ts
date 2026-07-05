import type { ReactiveController, ReactiveControllerHost } from "lit";

import type { ESPHomeAPI } from "../../../api/index.js";
import type {
  AutomationLocation,
  AutomationTree,
} from "../../../api/types/automations.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { notifyError } from "../../../util/notify.js";
import { applyYamlDiff, emptyAutomationTree } from "./serialise.js";

/** Debounce window between a value change and the auto-apply upsert.
 *  Coalesces bursts (typing into a templatable string param, dragging
 *  an action up/down repeatedly) into one backend round-trip. */
export const AUTO_APPLY_DEBOUNCE_MS = 200;

/** The slice of an automation-section editor the engine reads (and,
 *  for ``value``, writes). All three hosts (automation / script /
 *  api-action editor) expose exactly these reactive properties. */
export interface AutoApplyHost extends ReactiveControllerHost, EventTarget {
  configuration: string;
  yaml: string;
  addMode: boolean;
  value: AutomationTree | null;
  readonly location: AutomationLocation | null;
}

export interface AutoApplyOptions {
  /** Live API handle — read per call because the context decorator
   *  injects it after construction. */
  getApi(): ESPHomeAPI | undefined;
  getLocalize(): LocalizeFunc;
  /** True while the host's ParseErrorController renders read-only;
   *  a parse-errored automation must never upsert, or its empty
   *  tree would overwrite the real YAML block (#1050). */
  isReadOnly(): boolean;
  /** Per-editor upsert guard — absorbs the one line that differs
   *  between the hosts (a script can't upsert with an empty ``id``,
   *  an api action with an empty ``action_name``). Omitted = always
   *  applicable. */
  canApply?(location: AutomationLocation): boolean;
  /** Surface an inline error message on the host (its ``_error``
   *  state); the empty string clears it. */
  setError(message: string): void;
}

/**
 * Shared auto-apply / delete / dirty-tracking engine for the three
 * automation-section editors (automation, script, api-action).
 *
 * Owns the debounce timer, the in-flight/dirty coalescing state, the
 * self-written-YAML echo marker, and the ``section-mount`` /
 * ``section-unmount`` lifecycle announcements the device page uses to
 * hold a direct ref to the active section (see device.ts
 * ``_onSectionMount``). The controller shape gives proper teardown:
 * a pending debounced upsert is cancelled when the host disconnects.
 *
 * Events dispatched from the host element:
 *
 * - ``automation-change`` on every ``withValue`` mutation.
 * - ``dirty-change`` when the brief-window dirty flag flips — covers
 *   the debounce gap so the page's unsaved-changes guard fires the
 *   moment the user starts typing, not when the upsert resolves.
 * - ``yaml-draft`` after a successful upsert (the global save button
 *   is the only writer to disk; auto-apply only advances the page's
 *   YAML buffer).
 * - ``yaml-updated`` + ``section-select`` after a successful delete
 *   (delete writes through immediately via ``updateConfig``,
 *   matching the component editor's delete UX).
 *
 * Failures on either path surface a ``toast.error`` plus the host's
 * inline error message — per CLAUDE.md, a failed write must reach
 * the user instead of silently dropping.
 */
export class AutoApplyController implements ReactiveController {
  private _applyTimer: ReturnType<typeof setTimeout> | null = null;
  private _applyInFlight = false;
  private _applyDirty = false;
  private _lastSelfWrittenYaml: string | null = null;
  private _dirty = false;
  private _deleting = false;

  constructor(
    private readonly _host: AutoApplyHost,
    private readonly _options: AutoApplyOptions
  ) {
    _host.addController(this);
  }

  /** Announce so the device page can hold a direct ref and call
   *  ``flushPending()`` before its global save. Mirrors
   *  device-section-config's section-mount event. */
  hostConnected(): void {
    this._host.dispatchEvent(
      new CustomEvent("section-mount", {
        detail: { node: this._host },
        bubbles: true,
        composed: true,
      })
    );
  }

  hostDisconnected(): void {
    // Cancel the pending debounced upsert — a write scheduled by a
    // section that's no longer on screen must not fire.
    this._clearTimer();
    this._host.dispatchEvent(
      new CustomEvent("section-unmount", {
        detail: { node: this._host },
        bubbles: true,
        composed: true,
      })
    );
  }

  /** Brief-window dirty flag covering the debounce gap so the global
   *  save button activates as soon as the user types. */
  get dirty(): boolean {
    return this._dirty;
  }

  /** Disables the host's form chrome while a delete is running. */
  get deleting(): boolean {
    return this._deleting;
  }

  /** In-flight write guard — parents that re-fetch on reconnect
   *  consult this to skip clobbering an optimistic update. */
  get inFlightWrite(): boolean {
    return this._deleting || this._applyInFlight;
  }

  /**
   * Should the host's ``reload()`` skip re-hydrating from the live
   * YAML? True while an auto-apply is in flight (we're already
   * writing) or when the YAML prop is just our own write echoing
   * back (avoid clobbering the user's just-applied edit).
   */
  shouldSkipReload(): boolean {
    return this._applyInFlight || this._host.yaml === this._lastSelfWrittenYaml;
  }

  /** Patch the host's ``value``, announce ``automation-change`` so
   *  the parent can mirror state, and schedule the debounced upsert. */
  withValue(patch: Partial<AutomationTree>): void {
    const value: AutomationTree = {
      ...(this._host.value ?? emptyAutomationTree()),
      ...patch,
    };
    this._host.value = value;
    this._host.dispatchEvent(
      new CustomEvent("automation-change", {
        detail: { value, location: this._host.location },
        bubbles: true,
        composed: true,
      })
    );
    this.scheduleAutoApply();
  }

  /**
   * Schedule a debounced upsert. The global save button is the only
   * place that actually writes to disk; auto-apply keeps the page's
   * YAML buffer in sync with the editor state so the YAML pane
   * updates live and the save button activates. Not in add-mode —
   * the wizard owns the add flow, and skipping avoids upserting
   * partially-filled trees if a parent mounts the editor in
   * add-mode directly.
   */
  scheduleAutoApply(): void {
    if (this._host.addMode) return;
    if (this._options.isReadOnly()) return;
    this._setDirty(true);
    if (this._applyTimer) clearTimeout(this._applyTimer);
    this._applyTimer = setTimeout(() => {
      this._applyTimer = null;
      void this.autoApply();
    }, AUTO_APPLY_DEBOUNCE_MS);
  }

  /**
   * Force a pending debounced auto-apply to flush immediately. The
   * device page calls this (via the host) on the active section
   * before its global save so the YAML buffer is fully caught up.
   */
  async flushPending(): Promise<void> {
    if (this._applyTimer) {
      this._clearTimer();
      await this.autoApply();
    } else if (this._applyInFlight) {
      // Wait for the in-flight call to settle.
      while (this._applyInFlight) {
        await new Promise((r) => setTimeout(r, 20));
      }
    }
  }

  /**
   * Push the current ``value`` through ``automations/upsert``, apply
   * the returned diff to the page's YAML buffer, and dispatch
   * ``yaml-draft`` so the page picks it up. Only one upsert runs at
   * a time; if a value-change lands while we're in flight, the dirty
   * flag re-runs us on resolve so the latest value wins.
   */
  async autoApply(): Promise<void> {
    const api = this._options.getApi();
    const location = this._host.location;
    const value = this._host.value;
    if (!api || !location || !value) return;
    // Read-only: nothing to write, and drop any dirty a pre-error edit
    // left so the section can't stay stuck dirty with an empty tree.
    if (this._options.isReadOnly()) {
      this._setDirty(false);
      return;
    }
    if (this._options.canApply && !this._options.canApply(location)) return;
    if (this._applyInFlight) {
      this._applyDirty = true;
      return;
    }
    this._applyInFlight = true;
    this._applyDirty = false;
    try {
      // Pass the host's YAML so the backend computes the diff against
      // the current draft buffer rather than the on-disk YAML —
      // otherwise repeated auto-applies (the user typing into the
      // same field) would each re-insert the automation on top of
      // the previous draft's insertion.
      const { yaml_diff } = await api.upsertAutomation(
        this._host.configuration,
        value,
        location,
        this._host.yaml
      );
      const newYaml = applyYamlDiff(this._host.yaml, yaml_diff);
      // Track our own write so the parent's YAML-driven reload skips
      // the prop echo. Set before dispatch — the event handler is
      // synchronous and may already trigger ``updated()`` on the way
      // back, which is where the skip check runs.
      this._lastSelfWrittenYaml = newYaml;
      this._host.dispatchEvent(
        new CustomEvent<{ yaml: string }>("yaml-draft", {
          detail: { yaml: newYaml },
          bubbles: true,
          composed: true,
        })
      );
    } catch (err) {
      this._surfaceSaveError(err);
    } finally {
      this._applyInFlight = false;
      if (this._applyDirty) {
        // A value-change landed while we were running. Re-run with
        // the latest value so we don't drop the user's last edit.
        this._applyDirty = false;
        void this.autoApply();
      } else {
        // No further pending change — the page's YAML is now in sync
        // with our state. Clear the section-dirty flag; the page
        // still tracks _isYamlDirty separately (_yaml vs _savedYaml)
        // so the global save button stays armed.
        this._setDirty(false);
      }
    }
  }

  /**
   * Delete writes to disk directly (matches the component-editor
   * delete pattern in ``device-section-config/draft-and-delete``):
   * compute the new YAML via the backend's delete diff, write it via
   * ``api.updateConfig``, then dispatch ``yaml-updated`` (which
   * advances both ``_yaml`` AND ``_savedYaml`` on the page — a clean
   * state). Navigates away from the deleted section after.
   */
  async delete(): Promise<void> {
    const api = this._options.getApi();
    if (!api || !this._host.location || this._deleting) return;
    // Cancel any pending auto-apply — we're about to delete.
    this._clearTimer();
    this._setDeleting(true);
    this._options.setError("");
    try {
      const { yaml_diff } = await api.deleteAutomation(
        this._host.configuration,
        this._host.location,
        this._host.yaml
      );
      const newYaml = applyYamlDiff(this._host.yaml, yaml_diff);
      await api.updateConfig(this._host.configuration, newYaml);
      this._host.dispatchEvent(
        new CustomEvent<{ yaml: string }>("yaml-updated", {
          detail: { yaml: newYaml },
          bubbles: true,
          composed: true,
        })
      );
      this._host.dispatchEvent(
        new CustomEvent<{ sectionKey: string | null }>("section-select", {
          detail: { sectionKey: null },
          bubbles: true,
          composed: true,
        })
      );
    } catch (err) {
      this._surfaceSaveError(err);
    } finally {
      this._setDeleting(false);
    }
  }

  /** Failed write → inline error on the host plus a rich toast, so
   *  the user learns their edit didn't take effect (CLAUDE.md's
   *  revert-on-failure rule for optimistic updates). */
  private _surfaceSaveError(err: unknown): void {
    const localize = this._options.getLocalize();
    const msg =
      err instanceof Error ? err.message : localize("device.automation_save_error");
    this._options.setError(msg);
    notifyError(localize("device.automation_save_error"), {
      description: msg,
    });
  }

  private _clearTimer(): void {
    if (this._applyTimer) {
      clearTimeout(this._applyTimer);
      this._applyTimer = null;
    }
  }

  private _setDirty(value: boolean): void {
    if (this._dirty === value) return;
    this._dirty = value;
    this._host.requestUpdate();
    this._host.dispatchEvent(
      new CustomEvent("dirty-change", {
        detail: { dirty: value },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _setDeleting(value: boolean): void {
    this._deleting = value;
    this._host.requestUpdate();
  }
}
