import type { ReactiveController, ReactiveControllerHost } from "lit";

import type { ESPHomeAPI } from "../../../api/index.js";
import type {
  AutomationLocation,
  AutomationTree,
} from "../../../api/types/automations.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { fireEvent } from "../../../util/fire-event.js";
import { formatApiError } from "../../../util/format-api-error.js";
import { notifyError } from "../../../util/notify.js";
import { writeAutomationDelete } from "../apply-removal.js";
import type { SectionEditor } from "../section-editor.js";
import {
  announceSectionMount,
  fireSectionEvent,
  prepareSectionEvent,
} from "../section-editor.js";
import {
  applyYamlDiff,
  emptyAutomationTree,
  sectionKeyFromLocation,
} from "./serialise.js";

/** Debounce window between a value change and the auto-apply upsert.
 *  Coalesces bursts (typing into a templatable string param, dragging
 *  an action up/down repeatedly) into one backend round-trip. */
export const AUTO_APPLY_DEBOUNCE_MS = 200;

/** The slice of an automation-section editor the engine reads (and,
 *  for ``value``, writes). All three hosts (automation / script /
 *  api-action editor) expose exactly these reactive properties. */
export interface AutoApplyHost
  extends ReactiveControllerHost, EventTarget, SectionEditor {
  configuration: string;
  yaml: string;
  addMode: boolean;
  value: AutomationTree | null;
  readonly location: AutomationLocation | null;
  /** Mount-time anchor the delete path needs to keep its events
   *  reachable when the element is unmounted mid round trip (#1465). */
  readonly parentNode: ParentNode | null;
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

/** Apply pipeline phase. A queued re-run is only representable
 *  while a call is in flight, so the flag pair that used to drift
 *  apart (in-flight false with a stale queue bit, and vice versa)
 *  is now one value. The debounce timer stays a separate handle:
 *  typing during an in-flight round trip legitimately arms it
 *  while applying, and teardown cancels it without touching the
 *  in-flight call. ``settled`` resolves in the finally, after the
 *  queued re-run decision (its phase is installed first), so a
 *  waiter observes each round at its actual boundary. */
type ApplyPhase =
  | { kind: "idle" }
  | { kind: "applying"; queued: boolean; settled: Promise<void>; settle(): void };

/** A delete owning the section. Carrying the suppression record
 *  inside the mode means it cannot exist without a delete and
 *  cannot outlive the one that captured it. */
interface DeleteMode {
  /** An apply attempt was blocked while this delete owned the
   *  section; a failed delete re-arms it so the edit isn't
   *  silently dropped. */
  suppressed: boolean;
  /** Whose edit the suppression belongs to, so a mid-flush
   *  retarget's sibling edit survives a successful delete. */
  suppressedFor: AutomationLocation | null;
}

/**
 * Shared auto-apply / delete / dirty-tracking engine for the three
 * automation-section editors (automation, script, api-action).
 *
 * Owns the debounce timer, the apply phase (in-flight + queued
 * re-run), the self-written-YAML echo marker, and the ``section-mount`` /
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
 * - ``yaml-updated`` after a successful delete (delete writes through
 *   immediately via ``updateConfig``, matching the component editor's
 *   delete UX), plus ``section-select`` unless the element was
 *   re-pointed at a sibling mid-delete.
 *
 * Failures on either path surface a ``toast.error`` plus the host's
 * inline error message — per CLAUDE.md, a failed write must reach
 * the user instead of silently dropping.
 */
export class AutoApplyController implements ReactiveController {
  private _debounce: ReturnType<typeof setTimeout> | null = null;
  private _apply: ApplyPhase = { kind: "idle" };
  /** Non-null while a delete owns the section. */
  private _deleteMode: DeleteMode | null = null;
  private _lastSelfWrittenYaml: string | null = null;
  /** Basis for rounds running after an unmount: the detached prop
   *  can no longer echo the page's buffer, so each detached round
   *  chains onto its own previous result instead (#1479). */
  private _detachedBasis: string | null = null;
  private _dirty = false;
  // Whether the host element is on screen; a failure-path re-arm must not
  // schedule a write for a torn-down section.
  private _connected = false;
  private _announceUnmount: (() => void) | null = null;
  /** Mount-time parent for rounds prepared after the element left
   *  the tree (the drain, a detached queued re-run) — their
   *  ``parentNode`` is already null by then. */
  private _anchor: ParentNode | null = null;

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
    this._connected = true;
    this._detachedBasis = null;
    this._anchor = this._host.parentNode;
    this._announceUnmount = announceSectionMount(this._host);
  }

  hostDisconnected(): void {
    this._connected = false;
    // The frozen prop is the freshest buffer this element saw; the
    // first detached round bases on it, later ones chain (#1479).
    this._detachedBasis = this._host.yaml;
    // Drain a pending debounced edit instead of dropping it. The
    // switch paths' kick already flushes before unmount, so this
    // covers the unkicked unmounts only (a YAML-pane edit removing
    // the section, a reconnect reload, a device switch). Gated on
    // the anchor still being in the document: with the whole page
    // gone the draft has nowhere to land, and a failed round would
    // toast onto whatever page the user is on now.
    if (this._debounce !== null && this._anchor?.isConnected) {
      this._cancelDebounce();
      void this.autoApply();
    }
    // One-shot: the closure pairs with exactly one mount.
    this._announceUnmount?.();
    this._announceUnmount = null;
  }

  /** Brief-window dirty flag covering the debounce gap so the global
   *  save button activates as soon as the user types. */
  get dirty(): boolean {
    return this._dirty;
  }

  /** Disables the host's form chrome while a delete is running. */
  get deleting(): boolean {
    return this._deleteMode !== null;
  }

  /** In-flight write guard — parents that re-fetch on reconnect
   *  consult this to skip clobbering an optimistic update. */
  get inFlightWrite(): boolean {
    return this._deleteMode !== null || this._apply.kind === "applying";
  }

  /**
   * Should the host's ``reload()`` skip re-hydrating from the live
   * YAML? True while an auto-apply is in flight (we're already
   * writing) or when the YAML prop is just our own write echoing
   * back (avoid clobbering the user's just-applied edit).
   */
  shouldSkipReload(): boolean {
    return (
      this._apply.kind === "applying" || this._host.yaml === this._lastSelfWrittenYaml
    );
  }

  /** Patch the host's ``value``, announce ``automation-change`` so
   *  the parent can mirror state, and schedule the debounced upsert. */
  withValue(patch: Partial<AutomationTree>): void {
    const value: AutomationTree = {
      ...(this._host.value ?? emptyAutomationTree()),
      ...patch,
    };
    this._host.value = value;
    fireEvent(this._host, "automation-change", { value, location: this._host.location });
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
    if (this._deleteMode) {
      this._deleteMode.suppressed = true;
      this._deleteMode.suppressedFor = this._host.location;
      return;
    }
    this._setDirty(true);
    this._cancelDebounce();
    this._debounce = setTimeout(() => {
      this._debounce = null;
      void this.autoApply();
    }, AUTO_APPLY_DEBOUNCE_MS);
  }

  /**
   * Force a pending debounced auto-apply to flush immediately. The
   * device page calls this (via the host) on the active section
   * before its global save so the YAML buffer is fully caught up.
   * Resolves only once nothing is pending — neither a debounce
   * (even one armed mid-wait by a late keystroke) nor an in-flight
   * call, including the queued re-run a cancelled debounce leaves
   * on one.
   */
  async flushPending(): Promise<void> {
    // Terminates: during a delete, ``scheduleAutoApply`` refuses to
    // arm (the delete mode suppresses instead), so ``delete()``'s
    // call site can't spin; outside one, each iteration retires the
    // pending work that gated it.
    while (this._debounce || this._apply.kind === "applying") {
      if (this._debounce) {
        this._cancelDebounce();
        // With a call already in flight this only queues a re-run —
        // loop back so the caller isn't released while the keystroke
        // it came to flush is still unwritten.
        await this.autoApply();
      } else if (this._apply.kind === "applying") {
        await this._apply.settled;
        // Macrotask hop before the re-check: nested Lit update
        // cycles carry the settling upsert's ``yaml-draft`` back
        // into ``.yaml`` on microtasks, so resolving straight off
        // the settle would release the caller against a stale
        // buffer and reintroduce #1451. Only this settled branch
        // hops — ``delete()`` relies on entering with
        // ``_debounce === null`` so its wait lands here.
        await new Promise((r) => setTimeout(r));
      }
    }
  }

  /**
   * Push the current ``value`` through ``automations/upsert``, apply
   * the returned diff to the page's YAML buffer, and dispatch
   * ``yaml-draft`` so the page picks it up. Only one upsert runs at
   * a time; a value-change landing while we're in flight queues one
   * re-run on resolve so the latest value wins.
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
    // A delete owns the section from here on; a racing apply (the
    // in-flight queued re-run, a stray flushPending) must not run.
    if (this._deleteMode) {
      this._deleteMode.suppressed = true;
      // The snapshot from the top of the call, so the suppression is
      // tied to the apply attempt being blocked.
      this._deleteMode.suppressedFor = location;
      return;
    }
    if (this._apply.kind === "applying") {
      this._apply.queued = true;
      return;
    }
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => (settle = resolve));
    const phase = { kind: "applying" as const, queued: false, settled, settle };
    this._apply = phase;
    try {
      // Pass the host's YAML so the backend computes the diff against
      // the current draft buffer rather than the on-disk YAML —
      // otherwise repeated auto-applies (the user typing into the
      // same field) would each re-insert the automation on top of
      // the previous draft's insertion.
      const configuration = this._host.configuration;
      // Read the buffer exactly once: the backend computes the
      // diff's line coordinates against the string we send, so
      // splicing into a later re-read would silently mangle it.
      // Detached rounds chain instead — their prop cannot echo.
      const yaml = this._connected
        ? this._host.yaml
        : (this._detachedBasis ?? this._host.yaml);
      // Anchor captured before the await: a mid-flight unmount
      // (Back's composed switch) must not lose the draft (#1479).
      const announceDraft = prepareSectionEvent(this._host, "yaml-draft", this._anchor);
      const { yaml_diff } = await api.upsertAutomation(
        configuration,
        value,
        location,
        yaml
      );
      const newYaml = applyYamlDiff(yaml, yaml_diff);
      // Track our own write so the parent's YAML-driven reload skips
      // the prop echo. Set before dispatch — the event handler is
      // synchronous and may already trigger ``updated()`` on the way
      // back, which is where the skip check runs.
      this._lastSelfWrittenYaml = newYaml;
      if (!this._connected) this._detachedBasis = newYaml;
      // A reused element re-pointed at a sibling mid round trip must
      // not ride the active-section exemption with this round's
      // pre-retarget basis — a non-exempt node forces the landing
      // basis check instead.
      const retargeted =
        this._host.location === null ||
        sectionKeyFromLocation(this._host.location) !== sectionKeyFromLocation(location);
      announceDraft(this._connected, {
        configuration,
        yaml: newYaml,
        basedOn: yaml,
        node: retargeted ? new EventTarget() : this._host,
      });
    } catch (err) {
      this._surfaceSaveError(err);
    } finally {
      this._apply = { kind: "idle" };
      if (phase.queued) {
        // A value-change landed while we were running. Re-run with
        // the latest value so we don't drop the user's last edit.
        // Synchronously installs the re-run's phase, so a waiter
        // woken by the settle below re-checks against it. Detached
        // re-runs are safe: they chain their basis through
        // ``_detachedBasis``, so the draft lands instead of
        // toasting a discard.
        void this.autoApply();
      } else if (this._debounce === null) {
        // No further pending change — the page's YAML is now in sync
        // with our state. Clear the section-dirty flag; the page
        // still tracks _isYamlDirty separately (_yaml vs _savedYaml)
        // so the global save button stays armed. A still-armed
        // debounce means newer edits exist (a keystroke during this
        // round trip — possibly for a sibling the reused element was
        // re-pointed at, #1486); their own settle clears the flag.
        this._setDirty(false);
      }
      phase.settle();
    }
  }

  /**
   * Delete writes to disk directly (matches the component-editor
   * delete pattern in ``device-section-config/draft-and-delete``):
   * compute the new YAML via the backend's delete diff, write it via
   * ``api.updateConfig``, then dispatch ``yaml-updated`` with its
   * basis — the page advances both ``_yaml`` and ``_savedYaml`` when
   * the basis still matches, or only ``_savedYaml`` when the pane
   * moved past it (#1476). Navigates away from the deleted section
   * after, unless the reused element has already been re-pointed at
   * a sibling.
   */
  async delete(): Promise<void> {
    const api = this._options.getApi();
    if (!api || !this._host.location || this._deleteMode) return;
    // Snapshot the identity before any await: location is a reactive prop
    // the parent reassigns on navigation, and the element is reused across
    // sibling automations — a mid-flush section switch must not retarget
    // the delete.
    const location = this._host.location;
    const configuration = this._host.configuration;
    const announceUpdated = prepareSectionEvent(this._host, "yaml-updated", this._anchor);
    // Cancel any pending auto-apply — we're about to delete.
    const hadPending = this._debounce !== null;
    this._cancelDebounce();
    const mode: DeleteMode = { suppressed: false, suppressedFor: null };
    this._setDeleteMode(mode);
    this._options.setError("");
    let failed = false;
    try {
      // Settle the in-flight upsert (the timer is already cancelled)
      // before computing the delete diff: its late ``yaml-draft``
      // would otherwise land after our ``yaml-updated`` and resurrect
      // the deleted section (#1451). The delete mode blocks the
      // queued re-run, so this terminates.
      // ``flushPending`` must resolve on a MACROTASK — its settled
      // wait's setTimeout hop is load bearing here, not decorative:
      // dropping it would release this call against a stale
      // ``.yaml`` and reintroduce #1451.
      await this.flushPending();
      // Read the settled buffer exactly once: the backend computes
      // the diff's line coordinates against the string we send, so
      // splicing into a later re-read (a YAML-pane keystroke during
      // the round-trip) would silently mangle the write-through.
      const yaml = this._host.yaml;
      // The written YAML derives from the pre-round-trip snapshot;
      // the basis lets the page supersede-check it, so a draft a
      // newly mounted section made in the interim survives as
      // visible dirty state instead of being overwritten (#1476).
      await writeAutomationDelete(
        api,
        configuration,
        location,
        yaml,
        announceUpdated,
        () => this._connected
      );
      // Navigate away only while the editor is still on screen showing
      // the deleted section. After a mid-flush retarget the user is
      // already on a sibling (yanking them to null would also unmount
      // the editor and cancel the sibling's re-armed edit below); after
      // an unmount they already navigated somewhere else entirely.
      if (
        this._connected &&
        (!this._host.location ||
          sectionKeyFromLocation(this._host.location) ===
            sectionKeyFromLocation(location))
      ) {
        this._host.dispatchEvent(
          new CustomEvent<{ sectionKey: string | null }>("section-select", {
            detail: { sectionKey: null },
            bubbles: true,
            composed: true,
          })
        );
      }
    } catch (err) {
      failed = true;
      this._surfaceSaveError(err);
    } finally {
      this._setDeleteMode(null);
      this._settleDelete(mode, { failed, hadPending, location });
    }
  }

  /** Post-delete outcome routing: which edit, if any, survives. */
  private _settleDelete(
    mode: DeleteMode,
    outcome: { failed: boolean; hadPending: boolean; location: AutomationLocation }
  ): void {
    const { suppressed, suppressedFor } = mode;
    const { failed, hadPending, location } = outcome;
    if (failed) {
      // The section survived — land the edit the delete window
      // suppressed or cancelled instead of silently dropping it.
      // Only while still on screen: re-arming a torn-down section
      // would schedule a write for an editor that no longer exists.
      if (this._connected && (suppressed || hadPending)) this.scheduleAutoApply();
    } else if (
      suppressed &&
      suppressedFor &&
      this._connected &&
      this._host.location &&
      sectionKeyFromLocation(suppressedFor) !== sectionKeyFromLocation(location) &&
      sectionKeyFromLocation(this._host.location) ===
        sectionKeyFromLocation(suppressedFor)
    ) {
      // The suppressed edit belongs to a sibling the reused
      // element was re-pointed at mid-flush, and the element still
      // shows that sibling — so the re-armed timer writes exactly
      // the suppressed edit (autoApply reads host state at fire
      // time, not the snapshot). The editor stayed mounted (no
      // section-select above), so the timer lands.
      this.scheduleAutoApply();
    } else {
      // The deleted section's own edits die with it.
      this._setDirty(false);
    }
  }

  /** Failed write → inline error on the host plus a rich toast, so
   *  the user learns their edit didn't take effect (CLAUDE.md's
   *  revert-on-failure rule for optimistic updates). */
  private _surfaceSaveError(err: unknown): void {
    const localize = this._options.getLocalize();
    const msg = formatApiError(err, localize, "device.automation_save_error");
    this._options.setError(msg);
    notifyError(localize("device.automation_save_error"), {
      description: msg,
    });
  }

  private _cancelDebounce(): void {
    if (this._debounce) {
      clearTimeout(this._debounce);
      this._debounce = null;
    }
  }

  private _setDirty(value: boolean): void {
    if (this._dirty === value) return;
    this._dirty = value;
    this._host.requestUpdate();
    fireSectionEvent(this._host, "dirty-change", { dirty: value, node: this._host });
  }

  private _setDeleteMode(mode: DeleteMode | null): void {
    this._deleteMode = mode;
    this._host.requestUpdate();
  }
}
