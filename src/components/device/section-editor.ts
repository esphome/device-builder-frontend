/**
 * The contract the device page relies on from whichever section
 * editor is mounted — the component editor or one of the
 * automation-family editors. Both sides implement it explicitly so
 * drift is a compile error instead of a save-guard edge case; the
 * page's ``section-mount`` / ``section-unmount`` handlers and the
 * YAML-driven reload path type against it. The event trio the same
 * editors dispatch is covered too: firers go through
 * ``fireSectionEvent`` and consumers read the augmented
 * ``HTMLElementEventMap``, so a renamed event or a reshaped detail
 * is a compile error on both ends.
 */
import { fireEvent } from "../../util/fire-event.js";
export interface SectionEditor {
  /** Brief-window dirty flag so the global save button arms as
   *  soon as the user edits. */
  readonly dirty: boolean;

  /** Flush a pending debounced draft so callers reading the page's
   *  YAML next see the user's last keystroke. The component
   *  editor's local splice is synchronous; the automation editors'
   *  backend upsert is not — await when the caller needs the
   *  settled buffer. */
  flushPending(): void | Promise<void>;

  /** Re-hydrate from the live YAML after the pane changes the
   *  document out from under the editor. */
  reload(): void;
}

export interface SectionLifecycleDetail {
  node: SectionEditor;
}

export interface SectionDirtyChangeDetail {
  dirty: boolean;
}

/** The events every section editor dispatches for the device page. */
export interface SectionEditorEventMap {
  "section-mount": SectionLifecycleDetail;
  "section-unmount": SectionLifecycleDetail;
  "dirty-change": SectionDirtyChangeDetail;
}

/** ``fireEvent`` narrowed to the section-editor trio so both the
 *  name and the detail shape are checked at the firer. */
export function fireSectionEvent<K extends keyof SectionEditorEventMap>(
  target: EventTarget,
  name: K,
  detail: SectionEditorEventMap[K]
): void {
  fireEvent(target, name, detail);
}

declare global {
  interface HTMLElementEventMap {
    "section-mount": CustomEvent<SectionEditorEventMap["section-mount"]>;
    "section-unmount": CustomEvent<SectionEditorEventMap["section-unmount"]>;
    "dirty-change": CustomEvent<SectionEditorEventMap["dirty-change"]>;
  }
}
