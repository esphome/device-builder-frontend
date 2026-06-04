import type { HighlightStyle } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { Tree } from "@lezer/common";
import { highlightTree } from "@lezer/highlight";
import type { StickyScopeLine } from "./yaml-sticky-scope.js";

/** Live measurements of the editor's line-number gutter, read from the real
 *  DOM in the plugin's measure phase so the overlay tracks whatever inset CM
 *  (or a custom theme) actually renders, rather than a hard-coded constant. */
export interface GutterMetrics {
  /** Full ``.cm-gutters`` width (line numbers + the fold gutter basicSetup
   *  mounts to their right). */
  width: number;
  /** Line-number column width alone, narrower than ``width``. */
  lineNumberWidth: number;
  /** Computed left/right padding of a real line-number gutter cell. */
  padLeft: number;
  padRight: number;
}

/** Right inset that lands the full-gutters-wide num span's glyph on the
 *  line-number column's right edge: past the fold gutter, plus the gutter
 *  cell's own right padding (measured, so a CM/theme change can't drift it). */
export function stickyNumPaddingRight(m: GutterMetrics): number {
  if (m.width <= 0 || m.lineNumberWidth <= 0) return 8; // pre-measure fallback
  return m.width - m.lineNumberWidth + m.padRight;
}

export function createStickyRow(): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "cm-esphome-sticky-line";
  row.setAttribute("role", "button");
  row.tabIndex = 0;

  const num = document.createElement("span");
  num.className = "cm-esphome-sticky-num";
  row.appendChild(num);

  const text = document.createElement("span");
  text.className = "cm-esphome-sticky-text";
  row.appendChild(text);

  return row;
}

export function patchStickyRow(
  row: HTMLDivElement,
  sticky: StickyScopeLine,
  gutter: GutterMetrics,
  tree: Tree,
  state: EditorState,
  highlightStyle: HighlightStyle,
  jumpToLineLabel: (lineNumber: number) => string
): void {
  const lineStr = String(sticky.lineNumber);
  if (row.dataset.line !== lineStr) {
    row.dataset.line = lineStr;
    // Localized action name — doubles as the tooltip and the
    // accessible name (the row is role="button").
    const label = jumpToLineLabel(sticky.lineNumber);
    row.title = label;
    row.setAttribute("aria-label", label);
  }

  const num = row.firstElementChild as HTMLSpanElement;
  const widthStr = gutter.width > 0 ? `${gutter.width}px` : "";
  if (num.style.width !== widthStr) num.style.width = widthStr;
  const padRightStr = `${stickyNumPaddingRight(gutter)}px`;
  if (num.style.paddingRight !== padRightStr) num.style.paddingRight = padRightStr;
  // Mirror the gutter cell's measured left inset; empty before the first
  // measure leaves the theme's fallback in place.
  const padLeftStr = gutter.padLeft > 0 ? `${gutter.padLeft}px` : "";
  if (num.style.paddingLeft !== padLeftStr) num.style.paddingLeft = padLeftStr;
  if (num.textContent !== lineStr) num.textContent = lineStr;

  // Re-run the (relatively costly) syntax highlighting only when the row
  // binds to a different line OR that line's content changed. Keyed on
  // line + raw text so an edit to a pinned line still refreshes, but a row
  // re-patched with identical content (e.g. across a scope transition) is
  // left untouched.
  const sig = `${lineStr} ${sticky.text}`;
  if (row.dataset.sig !== sig) {
    row.dataset.sig = sig;
    const text = row.lastElementChild as HTMLSpanElement;
    text.replaceChildren();
    appendHighlightedText(text, sticky, tree, state, highlightStyle);
  }
}

function appendHighlightedText(
  host: HTMLElement,
  sticky: StickyScopeLine,
  tree: Tree,
  state: EditorState,
  highlightStyle: HighlightStyle
): void {
  const { doc } = state;
  const line = doc.line(Math.min(sticky.lineNumber, doc.lines));
  const from = line.from;
  const to = line.to;
  const text = state.sliceDoc(from, to);

  let pos = from;
  highlightTree(
    tree,
    highlightStyle,
    (tokenFrom, tokenTo, classes) => {
      if (tokenFrom > pos) {
        host.appendChild(
          document.createTextNode(text.slice(pos - from, tokenFrom - from))
        );
      }
      const span = document.createElement("span");
      span.className = classes;
      span.textContent = text.slice(tokenFrom - from, tokenTo - from);
      host.appendChild(span);
      pos = tokenTo;
    },
    from,
    to
  );
  if (pos < to) {
    host.appendChild(document.createTextNode(text.slice(pos - from)));
  }
}
