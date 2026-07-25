/**
 * The contract the device page relies on from whichever section
 * editor is mounted — the component editor or one of the
 * automation-family editors. Both sides implement it explicitly so
 * drift is a compile error instead of a save-guard edge case; the
 * page's ``section-mount`` / ``section-unmount`` handlers and the
 * YAML-driven reload path type against it.
 */
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
