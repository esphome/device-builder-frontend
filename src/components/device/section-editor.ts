/**
 * The contract the device page relies on from whichever section
 * editor is mounted — the component editor or one of the
 * automation-family editors. Both sides implement it explicitly so
 * drift is a compile error instead of a save-guard edge case; the
 * page's ``section-mount`` / ``section-unmount`` handlers and the
 * YAML-driven reload path type against it. The events the same
 * editors dispatch are covered too: firers go through
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
  /** Which editor spoke — the page ignores a stale emitter's flip
   *  so it cannot overwrite the active section's dirty state. */
  node: SectionEditor;
}

/** A completed disk write and the buffer it was computed against —
 *  the page supersede-checks the basis and advances only the saved
 *  side when the pane has moved past it (#1476). */
export interface YamlUpdatedDetail {
  yaml: string;
  basedOn: string;
}

/** The events every section editor dispatches for the device page. */
export interface SectionEditorEventMap {
  "section-mount": SectionLifecycleDetail;
  "section-unmount": SectionLifecycleDetail;
  "dirty-change": SectionDirtyChangeDetail;
  "yaml-updated": YamlUpdatedDetail;
}

/** ``fireEvent`` narrowed to the section-editor event map so both
 *  the name and the detail shape are checked at the firer. */
export function fireSectionEvent<K extends keyof SectionEditorEventMap>(
  target: EventTarget,
  name: K,
  detail: SectionEditorEventMap[K]
): void {
  fireEvent(target, name, detail);
}

/**
 * Capture what a disk-writing delete needs to announce its
 * ``yaml-updated`` after the round trip, before any await: the
 * mount-time parent (the host may be unmounted by dispatch time —
 * detached dispatches bubble nowhere, #1465). The returned announcer
 * takes the host's connectedness at dispatch time and the write with
 * its required basis, typed through the section event map so a
 * future emitter cannot drop the basis and compile.
 */
export function prepareYamlUpdated(
  host: EventTarget & { readonly parentNode: ParentNode | null }
): (connected: boolean, write: YamlUpdatedDetail) => void {
  const anchor = host.parentNode;
  return (connected, write) => {
    const target = connected ? host : anchor;
    if (target) fireSectionEvent(target, "yaml-updated", write);
  };
}

/**
 * Announce ``section-mount`` from *host* and return the matching
 * unmount announcer. The unmount rides the parent captured here:
 * disconnect callbacks run after the node has left the tree, and a
 * detached dispatch bubbles nowhere (#1483). A never-mounted host
 * falls back to itself — a harmless no-op dispatch.
 */
export function announceSectionMount(
  host: SectionEditor & EventTarget & { readonly parentNode: ParentNode | null }
): () => void {
  const anchor = host.parentNode;
  fireSectionEvent(host, "section-mount", { node: host });
  return () => fireSectionEvent(anchor ?? host, "section-unmount", { node: host });
}

declare global {
  interface HTMLElementEventMap {
    "section-mount": CustomEvent<SectionEditorEventMap["section-mount"]>;
    "section-unmount": CustomEvent<SectionEditorEventMap["section-unmount"]>;
    "dirty-change": CustomEvent<SectionEditorEventMap["dirty-change"]>;
    "yaml-updated": CustomEvent<SectionEditorEventMap["yaml-updated"]>;
  }
}
