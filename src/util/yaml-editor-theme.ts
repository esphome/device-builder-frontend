import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

/**
 * VSCode-flavored CodeMirror themes for the YAML editor.
 *
 * Dark mode mirrors VSCode "Dark+":
 *   keys light-blue, strings peach, comments green italic,
 *   tags teal, anchors/aliases yellow.
 *
 * Light mode uses a GitHub-light-ish palette — strings are
 * deliberately not red (the CM default light highlight paints
 * them red, which reads as an error to anyone used to VSCode).
 */

const DARK_BG = "#1e1e1e";
const DARK_FG = "#d4d4d4";
const DARK_GUTTER_FG = "#858585";
const DARK_SELECTION = "#264f78";
const DARK_ACTIVE_LINE = "#2a2d2e";
const DARK_CURSOR = "#aeafad";

const LIGHT_BG = "#ffffff";
const LIGHT_FG = "#1f2328";
const LIGHT_GUTTER_FG = "#6e7781";
const LIGHT_SELECTION = "#add6ff";
const LIGHT_ACTIVE_LINE = "#f6f8fa";
const LIGHT_CURSOR = "#1f2328";

const darkHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "#569cd6" },
  { tag: t.string, color: "#98c379" },
  { tag: t.special(t.string), color: "#98c379" },
  { tag: t.attributeValue, color: "#98c379" },
  { tag: t.number, color: "#d19a66" },
  { tag: t.bool, color: "#569cd6" },
  { tag: t.null, color: "#569cd6" },
  { tag: t.atom, color: "#569cd6" },
  { tag: [t.lineComment, t.blockComment, t.comment], color: "#6a9955", fontStyle: "italic" },
  { tag: t.definition(t.propertyName), color: "#9cdcfe" },
  { tag: t.propertyName, color: "#9cdcfe" },
  { tag: t.labelName, color: "#dcdcaa" },
  { tag: t.typeName, color: "#4ec9b0" },
  { tag: t.meta, color: "#c586c0" },
  { tag: [t.separator, t.punctuation, t.bracket, t.squareBracket, t.brace], color: DARK_FG },
  { tag: t.content, color: DARK_FG },
]);

const lightHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "#a626a4" },
  { tag: t.string, color: "#50a14f" },
  { tag: t.special(t.string), color: "#50a14f" },
  { tag: t.attributeValue, color: "#50a14f" },
  { tag: t.number, color: "#986801" },
  { tag: t.bool, color: "#0550ae" },
  { tag: t.null, color: "#0550ae" },
  { tag: t.atom, color: "#0550ae" },
  { tag: [t.lineComment, t.blockComment, t.comment], color: "#6e7781", fontStyle: "italic" },
  { tag: t.definition(t.propertyName), color: "#0550ae" },
  { tag: t.propertyName, color: "#0550ae" },
  { tag: t.labelName, color: "#6f42c1" },
  { tag: t.typeName, color: "#953800" },
  { tag: t.meta, color: "#8250df" },
  { tag: [t.separator, t.punctuation, t.bracket, t.squareBracket, t.brace], color: LIGHT_FG },
  { tag: t.content, color: LIGHT_FG },
]);

const darkBase = EditorView.theme(
  {
    "&": {
      color: DARK_FG,
      backgroundColor: DARK_BG,
    },
    ".cm-content": {
      caretColor: DARK_CURSOR,
    },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: DARK_CURSOR },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      { backgroundColor: DARK_SELECTION },
    ".cm-activeLine": { backgroundColor: DARK_ACTIVE_LINE },
    ".cm-activeLineGutter": { backgroundColor: DARK_ACTIVE_LINE },
    ".cm-gutters": {
      backgroundColor: DARK_BG,
      color: DARK_GUTTER_FG,
      border: "none",
    },
    ".cm-lineNumbers .cm-gutterElement": { color: DARK_GUTTER_FG },
    ".cm-foldPlaceholder": {
      backgroundColor: "transparent",
      border: "none",
      color: "#9aa0a6",
    },
    ".cm-panels": { backgroundColor: "#252526", color: DARK_FG },
    ".cm-searchMatch": {
      backgroundColor: "#613214",
      outline: "1px solid #f8c555",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "#9d550f",
    },
  },
  { dark: true },
);

const lightBase = EditorView.theme(
  {
    "&": {
      color: LIGHT_FG,
      backgroundColor: LIGHT_BG,
    },
    ".cm-content": {
      caretColor: LIGHT_CURSOR,
    },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: LIGHT_CURSOR },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      { backgroundColor: LIGHT_SELECTION },
    ".cm-activeLine": { backgroundColor: LIGHT_ACTIVE_LINE },
    ".cm-activeLineGutter": { backgroundColor: LIGHT_ACTIVE_LINE },
    ".cm-gutters": {
      backgroundColor: LIGHT_BG,
      color: LIGHT_GUTTER_FG,
      border: "none",
    },
    ".cm-lineNumbers .cm-gutterElement": { color: LIGHT_GUTTER_FG },
    ".cm-foldPlaceholder": {
      backgroundColor: "transparent",
      border: "none",
      color: "#6e7781",
    },
    ".cm-panels": { backgroundColor: "#f6f8fa", color: LIGHT_FG },
    ".cm-searchMatch": {
      backgroundColor: "#fff8c5",
      outline: "1px solid #d4a72c",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "#ffd33d",
    },
  },
  { dark: false },
);

export const vscodeDark: Extension = [darkBase, syntaxHighlighting(darkHighlight)];
export const vscodeLight: Extension = [lightBase, syntaxHighlighting(lightHighlight)];
