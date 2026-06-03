import type { HighlightStyle } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { Tree } from "@lezer/common";
import { highlightTree } from "@lezer/highlight";
import type { StickyScopeLine } from "./yaml-sticky-scope.js";

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
  gutterWidth: number,
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
  const widthStr = gutterWidth > 0 ? `${gutterWidth}px` : "";
  if (num.style.width !== widthStr) num.style.width = widthStr;
  if (num.textContent !== lineStr) num.textContent = lineStr;

  const text = row.lastElementChild as HTMLSpanElement;
  text.replaceChildren();
  appendHighlightedText(text, sticky, tree, state, highlightStyle);
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
