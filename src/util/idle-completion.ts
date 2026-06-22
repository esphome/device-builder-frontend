/**
 * Idle autocompletion trigger for the YAML editor.
 *
 * The completion source only fires while typing (or on Ctrl-Space), so a
 * caret resting on a blank indented line or an empty ``key:`` offers no
 * discovery of what's allowed there. This extension opens the popup after
 * the caret idles. ``startCompletion`` triggers an *explicit* completion,
 * which the source answers even with an empty partial, so no change to the
 * source's typing-time gate is needed.
 */
import { completionStatus, startCompletion } from "@codemirror/autocomplete";
import type { EditorState } from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { matchKeyPosition, matchValuePosition } from "./yaml-completion-catalog.js";

/**
 * Whether an idle trigger should open the popup at the caret: a settled
 * single caret at end of line, in a key or value discovery position, with
 * no popup already open.
 */
export function shouldIdleComplete(state: EditorState): boolean {
  if (completionStatus(state) !== null) return false;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  if (sel.head !== line.to) return false;
  const before = line.text.slice(0, sel.head - line.from);
  return matchKeyPosition(before) !== null || matchValuePosition(before) !== null;
}

/** Open the completion popup *delayMs* after the caret last moved or the
 *  doc last changed, for at-rest key/value discovery. */
export function idleCompletion(delayMs: number) {
  return ViewPlugin.fromClass(
    class {
      private timer: ReturnType<typeof setTimeout> | null = null;

      update(update: ViewUpdate): void {
        if (!update.docChanged && !update.selectionSet) return;
        this.arm(update.view);
      }

      destroy(): void {
        this.clear();
      }

      private arm(view: EditorView): void {
        this.clear();
        this.timer = setTimeout(() => {
          this.timer = null;
          if (shouldIdleComplete(view.state)) startCompletion(view);
        }, delayMs);
      }

      private clear(): void {
        if (this.timer !== null) {
          clearTimeout(this.timer);
          this.timer = null;
        }
      }
    }
  );
}
