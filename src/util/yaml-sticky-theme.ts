import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export function buildStickyTheme(background: string): Extension {
  return EditorView.theme({
    ".cm-esphome-sticky": {
      position: "absolute",
      top: "0",
      left: "0",
      right: "0",
      zIndex: "3",
      pointerEvents: "auto",
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: "13px",
      lineHeight: "1.4",
      background,
      boxShadow: "0 1px 0 rgba(0, 0, 0, 0.15), 0 2px 4px rgba(0, 0, 0, 0.08)",
      overflow: "hidden",
      "&:empty": {
        display: "none",
      },
    },
    ".cm-esphome-sticky-line": {
      display: "flex",
      flexDirection: "row",
      cursor: "pointer",
      whiteSpace: "pre",
      position: "relative",
      background: "inherit",
    },
    ".cm-esphome-sticky-line:hover": {
      background: "rgba(127, 127, 127, 0.12)",
    },
    ".cm-esphome-sticky-line:focus-visible": {
      outline: "2px solid #0b5cad",
      outlineOffset: "-2px",
    },
    ".cm-esphome-sticky-num": {
      flex: "0 0 auto",
      boxSizing: "border-box",
      textAlign: "right",
      paddingRight: "8px",
      paddingLeft: "8px",
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
