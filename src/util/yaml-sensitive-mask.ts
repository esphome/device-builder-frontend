/**
 * CodeMirror extension that masks sensitive credential values
 * (passwords, encryption keys, PSKs) in the YAML editor — the
 * YAML-pane counterpart to `<esphome-password-input>` in the
 * config-entry form. Without it, a password field hidden in the form
 * is still visible as plain text in the YAML pane to the right.
 *
 * Distinct from ESPHome's `!secret <name>` machinery: this extension
 * masks raw inline credentials. `!secret`-tagged lines carry only
 * the indirection name and are passed through unchanged by
 * `findSensitiveValueRanges`.
 *
 * Strategy:
 *   - On every doc change, rescan the document with
 *     `findSensitiveValueRanges` and apply a `mark` decoration
 *     carrying the `cm-esphome-sensitive-value` class to the value
 *     portion of each sensitive line.
 *   - The class uses `-webkit-text-security: disc` (Firefox 125+,
 *     Safari, all Chromium) to render the value as bullets without
 *     altering the underlying text. Editing still works through the
 *     bullets; the user just sees dots.
 *   - A reveal flag toggled via `setRevealSensitiveEffect` clears
 *     all decorations so the toolbar's reveal button can flip the
 *     whole editor at once.
 */

import { type Range } from "@codemirror/state";
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { findSensitiveValueRanges } from "./yaml-sensitive-scan.js";

export const setRevealSensitiveEffect = StateEffect.define<boolean>();

const sensitiveMark = Decoration.mark({ class: "cm-esphome-sensitive-value" });

function computeDecorations(
  state: EditorState,
  revealed: boolean,
  maskAllValues: boolean
): DecorationSet {
  if (revealed) return Decoration.none;
  const doc = state.doc;
  // Pass ``EditorState.doc`` (CodeMirror's ``Text``) directly to
  // the scanner — it iterates lines via ``doc.line(n).text`` rather
  // than calling ``doc.toString().split("\n")``. Avoids a full-
  // document string allocation and the split on every keystroke;
  // the editor's update listener already pays one ``toString()``
  // for the ``yaml-change`` dispatch and we don't want to double
  // that just to compute mask decorations.
  const ranges = findSensitiveValueRanges(doc, { maskAllValues });
  if (ranges.length === 0) return Decoration.none;
  const built: Range<Decoration>[] = [];
  for (const r of ranges) {
    if (r.line < 1 || r.line > doc.lines) continue;
    const lineStart = doc.line(r.line).from;
    const from = lineStart + r.valueFrom;
    const to = lineStart + r.valueTo;
    if (to > from) built.push(sensitiveMark.range(from, to));
  }
  return Decoration.set(built, true);
}

export function sensitiveValueMaskExtension(
  initialReveal = false,
  maskAllValues = false
): Extension {
  // Holds the current reveal flag so the field can short-circuit
  // when the user has the toolbar reveal button on.
  const revealedField = StateField.define<boolean>({
    create: () => initialReveal,
    update(value, tr) {
      for (const effect of tr.effects) {
        if (effect.is(setRevealSensitiveEffect)) return effect.value;
      }
      return value;
    },
  });

  // Recomputes decorations whenever the doc changes OR the reveal
  // flag flips. Living in a StateField (not a ViewPlugin) means the
  // decorations are part of the editor state and the initial doc
  // mounts already-masked — no flash of plaintext on load.
  //
  // ``maskAllValues`` is captured here at extension-construction
  // time. The flag is set once by the host page (false everywhere
  // except the secrets editor) and is not expected to toggle at
  // runtime — a change would require rebuilding the editor (the
  // same path dark-mode and configuration changes already use).
  const decoField = StateField.define<DecorationSet>({
    create: (state) =>
      computeDecorations(state, state.field(revealedField), maskAllValues),
    update(decos, tr) {
      const revealed = tr.state.field(revealedField);
      const revealedChanged = tr.effects.some((e) => e.is(setRevealSensitiveEffect));
      if (!tr.docChanged && !revealedChanged) {
        return decos.map(tr.changes);
      }
      return computeDecorations(tr.state, revealed, maskAllValues);
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  return [revealedField, decoField, sensitiveMaskTheme];
}

const sensitiveMaskTheme = EditorView.theme({
  ".cm-esphome-sensitive-value": {
    // Standard property is `text-security` (CSS Working Draft); the
    // `-webkit-` prefix is what actually ships in browsers today.
    // Firefox accepts the prefixed form since 125; Chromium/Safari
    // have shipped it for years. We set both so a future un-prefix
    // doesn't regress.
    "-webkit-text-security": "disc",
    "text-security": "disc",
    // Letter-spacing nudge so the bullets sit a bit looser and don't
    // mash together — purely cosmetic, mirrors how bullets render in
    // a native `<input type="password">`.
    "letter-spacing": "0.5px",
  },
});
