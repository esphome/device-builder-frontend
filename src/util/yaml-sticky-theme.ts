import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { EDITOR_FONT_FAMILY, EDITOR_FONT_SIZE } from "./yaml-editor-theme.js";

export function buildStickyTheme(background: string): Extension {
  return EditorView.theme({
    ".cm-esphome-sticky": {
      position: "absolute",
      top: "0",
      left: "0",
      right: "0",
      zIndex: "3",
      pointerEvents: "auto",
      // Typography mirrors the editor content (shared constants), and
      // each row's height is pinned to the editor's measured
      // ``defaultLineHeight`` via the ``--esphome-sticky-row-h`` var the
      // plugin sets — so the overlay rows are exactly as tall as the
      // lines they shadow and the slide math stays aligned.
      fontFamily: EDITOR_FONT_FAMILY,
      fontSize: EDITOR_FONT_SIZE,
      background,
      boxShadow: "0 2px 0 rgba(0, 0, 0, 0.25), 0 2px 4px rgba(0, 0, 0, 0.08)",
      overflow: "hidden",
      "&:empty": {
        display: "none",
      },
    },
    ".cm-esphome-sticky-line": {
      // Absolutely positioned: the plugin sets each row's ``top`` (the
      // bottom row slides via Monaco's lastLineRelativePosition), and the
      // overlay's ``overflow: hidden`` clips a sliding row cleanly.
      display: "flex",
      flexDirection: "row",
      cursor: "pointer",
      whiteSpace: "pre",
      position: "absolute",
      left: "0",
      right: "0",
      background: "inherit",
      height: "var(--esphome-sticky-row-h)",
      lineHeight: "var(--esphome-sticky-row-h)",
    },
    ".cm-esphome-sticky-line:hover": {
      background: "rgba(127, 127, 127, 0.12)",
    },
    ".cm-esphome-sticky-line:focus-visible": {
      // Brand focus ring via the WebAwesome token (matches the lambda
      // editor's CodeMirror outline); literal fallback for older themes.
      outline: "2px solid var(--wa-color-brand-fill-loud, #0b5cad)",
      outlineOffset: "-2px",
    },
    ".cm-esphome-sticky-num": {
      flex: "0 0 auto",
      boxSizing: "border-box",
      textAlign: "right",
      // Both paddings are set per-row inline (yaml-sticky-render) from the
      // gutter cell's measured inset; this 5px is only the pre-measure
      // fallback for the first paint.
      paddingLeft: "5px",
      opacity: "0.65",
      userSelect: "none",
    },
    ".cm-esphome-sticky-text": {
      flex: "1 1 auto",
      paddingLeft: "4px",
      whiteSpace: "pre",
    },
  });
}
