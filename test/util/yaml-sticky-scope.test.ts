import { describe, expect, it } from "vitest";
import {
  computeStickyScope,
  findScopeExitLine,
  isScopeOpener,
} from "../../src/util/yaml-sticky-scope.js";

/**
 * Pin the legacy esphome dashboard's sticky-scroll shape: walking
 * backwards from the topmost visible line, collect each non-blank /
 * non-banner-comment line whose indent is strictly less than the
 * previously collected indent. Result is outermost-first so the
 * overlay can render top-down in document order.
 *
 * The topmost rendered line itself is NOT included in the chain,
 * even when it's a scope opener — that line is still rendered in
 * the doc body just below the overlay, so pinning it as well
 * would produce a visible duplication ("blinking") as the user
 * scrolls past it. The "pin the block header you scrolled past"
 * reading is preserved because the moment scrollTop crosses into
 * the next line, the previous line becomes an *ancestor* in the
 * walk-back and gets pinned at exactly the right scroll position.
 *
 * Indentation in YAML is purely positional, so a ``- platform: gpio``
 * list-item header at column 2 is recognised as a child of a
 * column-0 ``binary_sensor:`` block — no AST dependency.
 */

function fromYaml(yaml: string): string[] {
  return yaml.split("\n");
}

describe("computeStickyScope", () => {
  it("returns empty for the first line even when it's a scope opener", () => {
    // ``esphome:`` at line 1 IS a scope opener (line 2 sits
    // deeper), but it's also still rendered as the topmost line
    // of the doc body — pinning it as well would put the same
    // text in two places on screen at once. The chain stays
    // empty until the user scrolls past line 1, at which point
    // line 1 becomes an ancestor (not a topVisibleLine) and is
    // correctly pinned by the walk-back below.
    const lines = fromYaml("esphome:\n  name: x\n  on_boot:\n    then: x\n");
    expect(computeStickyScope(lines, 1)).toEqual([]);
  });

  it("returns empty for the first line when it's a leaf", () => {
    // A column-0 line whose next line is at the SAME indent (or
    // shallower) isn't a scope opener — nothing nests under it.
    // Pinning it would be noise.
    const lines = fromYaml("a:\nb:\nc:\n");
    expect(computeStickyScope(lines, 1)).toEqual([]);
  });

  it("returns empty for a top-level leaf key at indent 0", () => {
    // ``wifi:`` here has no children (next non-blank is the next
    // top-level key). Not a scope opener — no enclosing context
    // exists OR is opened.
    const lines = fromYaml(
      [
        "esphome:", //         1
        "  name: x", //        2
        "wifi:", //            3   ← top visible, leaf at indent 0
        "logger:", //          4
      ].join("\n"),
    );
    expect(computeStickyScope(lines, 3)).toEqual([]);
  });

  it("returns empty for a top-level scope opener at topVisibleLine", () => {
    // ``wifi:`` at line 3 opens a block (ssid sits deeper) but
    // is still in the doc body just below the overlay — pinning
    // it as well would visibly duplicate the line. Empty chain
    // here; wifi: gets pinned as soon as scrollTop crosses into
    // line 4 (where wifi: becomes an ancestor of the walk).
    const lines = fromYaml(
      [
        "esphome:", //         1
        "  name: x", //        2
        "wifi:", //            3   ← top visible, opens block
        "  ssid: foo", //      4
      ].join("\n"),
    );
    expect(computeStickyScope(lines, 3)).toEqual([]);
  });

  it("collects a single parent for a one-deep nested line", () => {
    const lines = fromYaml(
      [
        "esphome:", //         1
        "  name: x", //        2   ← top visible, leaf at indent 2
      ].join("\n"),
    );
    const scope = computeStickyScope(lines, 2);
    expect(scope.map((s) => s.lineNumber)).toEqual([1]);
    expect(scope[0].indent).toBe(0);
    expect(scope[0].text).toBe("esphome:");
  });

  it("walks the full chain for the acurite example", () => {
    // Mirrors the screenshot in the PR description — a deeply
    // nested ``binary_sensor → - platform → devices → - device →
    // battery_level`` chain. The walker should pin all five
    // ancestor lines when the cursor is below ``battery_level:``.
    const lines = fromYaml(
      [
        "binary_sensor:", //                            1   indent 0
        "  - platform: acurite", //                     2   indent 2
        "    devices:", //                              3   indent 4
        "      - device: 0x0083", //                    4   indent 6
        "        battery_level:", //                    5   indent 8
        "          id: battery_level_lightning", //     6   indent 10  ← top visible (leaf)
        "      - device: 0x1755", //                    7
      ].join("\n"),
    );
    const scope = computeStickyScope(lines, 6);
    // ``id:`` is a leaf (next line at lower indent) — not a
    // scope opener, so it isn't pinned. All five strictly-less
    // ancestors are.
    expect(scope.map((s) => s.lineNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(scope.map((s) => s.indent)).toEqual([0, 2, 4, 6, 8]);
  });

  it("pins only the ancestor when a list-item header is at topVisibleLine", () => {
    // ``- platform: acurite`` (indent 2) opens a block, but
    // it's still rendered in the doc body just below the
    // overlay — pinning it as well would visibly duplicate the
    // line. The ``binary_sensor:`` ancestor IS pinned because
    // it's walked back as an ancestor of the topmost line.
    // The platform header becomes a pinned row the moment the
    // user scrolls one more line down (it joins the walk-back
    // as an ancestor of the new topVisibleLine).
    const lines = fromYaml(
      [
        "binary_sensor:", //              1   indent 0
        "  - platform: acurite", //       2   indent 2 ← top visible, opens block
        "    devices:", //                3   indent 4
      ].join("\n"),
    );
    const scope = computeStickyScope(lines, 2);
    expect(scope.map((s) => s.lineNumber)).toEqual([1]);
  });

  it("ignores sibling list items at the same indent", () => {
    // Walking back from ``  - platform: bme280``, the previous
    // ``  - platform: dht`` is at the SAME indent (2). Same-indent
    // siblings are NOT enclosing scopes — only strictly-less
    // ancestry counts. Two assertions: bme280 itself is pinned
    // (it opens its own ``name:`` block — but in this test it's
    // a leaf, so it isn't), and the dht sibling is skipped.
    const lines = fromYaml(
      [
        "sensor:", //                  1   indent 0
        "  - platform: dht", //        2   indent 2
        "    name: kitchen", //        3   indent 4
        "  - platform: bme280", //     4   indent 2  ← top visible (leaf — no body)
      ].join("\n"),
    );
    const scope = computeStickyScope(lines, 4);
    expect(scope.map((s) => s.lineNumber)).toEqual([1]);
  });

  it("skips blank lines during the walk", () => {
    // A stray blank line in the middle of a section shouldn't
    // break the chain — the walker should look through it to the
    // next non-blank ancestor. Mirrors the ``walks back over
    // blank lines`` policy in the indent service.
    const lines = fromYaml(
      [
        "sensor:", //                  1
        "  - platform: dht", //        2
        "", //                         3   blank
        "    name: kitchen", //        4   ← top visible, indent 4
      ].join("\n"),
    );
    const scope = computeStickyScope(lines, 4);
    expect(scope.map((s) => s.lineNumber)).toEqual([1, 2]);
  });

  it("skips column-0 banner comments", () => {
    // ``## --- ##`` banners between sections decorate the next
    // section, not the surrounding scope (same trim policy as
    // ``parseYamlTopLevelSections``). The walker should look
    // past them to find the real ancestor.
    const lines = fromYaml(
      [
        "esphome:", //                  1   indent 0
        "  name: x", //                 2
        "## ---------- ##", //          3   column-0 banner
        "## Components ##", //          4   column-0 banner
        "sensor:", //                   5   indent 0
        "  - platform: dht", //         6   ← top visible, indent 2
      ].join("\n"),
    );
    const scope = computeStickyScope(lines, 6);
    expect(scope.map((s) => s.lineNumber)).toEqual([5]);
  });

  it("starts the walk from indent of a blank top-visible line", () => {
    // If the topmost visible line happens to be blank, the walker
    // adopts the indent of the previous non-blank line as its
    // bound — so the chain stays stable as scrollTop crosses a
    // blank line inside an existing scope. An earlier draft used
    // ``Infinity`` here, which let the walk pick up every leaf
    // along the way and made the chain explode by 1–2 rows on
    // every blank line (visible as trembling while scrolling).
    const lines = fromYaml(
      [
        "sensor:", //                  1
        "  - platform: dht", //        2
        "    name: kitchen", //        3
        "", //                         4   ← top visible (blank)
        "  - platform: bme280", //     5
      ].join("\n"),
    );
    const scope = computeStickyScope(lines, 4);
    // Previous non-blank is line 3 (indent 4) — that's the bound.
    // Walk back from line 3's slot: line 2 (indent 2) is the
    // strictly-less ancestor, then line 1 (indent 0). Line 3
    // itself is a leaf and isn't pinned. Result matches what the
    // chain looks like at line 3 — stable across the blank.
    expect(scope.map((s) => s.lineNumber)).toEqual([1, 2]);
  });

  it("returns empty for out-of-range top visible lines", () => {
    const lines = fromYaml("esphome:\n  name: x\n");
    expect(computeStickyScope(lines, 0)).toEqual([]);
    expect(computeStickyScope(lines, -5)).toEqual([]);
    expect(computeStickyScope(lines, 9999)).toEqual([]);
  });

  it("EOF-anchored: returns ancestors of a last-line leaf", () => {
    // The "next line indent" lookup walks forward through blank
    // lines and runs off the end when the top visible line is
    // the last meaningful line. The walker should still collect
    // strictly-less-indented ancestors (it just won't pin the
    // top line itself, since EOF means no body underneath it).
    const lines = fromYaml(
      [
        "sensor:", //                  1
        "  - platform: dht", //        2
        "    name: kitchen", //        3   ← top visible at EOF
        "",
      ].join("\n"),
    );
    const scope = computeStickyScope(lines, 3);
    expect(scope.map((s) => s.lineNumber)).toEqual([1, 2]);
  });

  it("preserves the raw line text, not the stripped version", () => {
    // Renderers slice tokens from the editor's document, so the
    // returned ``text`` must match the document byte-for-byte —
    // trailing comments and whitespace included. Stripping them
    // would force the renderer to maintain its own copy of the
    // raw line, which would drift.
    const lines = fromYaml(
      [
        "esphome:  # device-wide", //   1   trailing comment
        "  name: x", //                 2   ← top visible
      ].join("\n"),
    );
    const scope = computeStickyScope(lines, 2);
    expect(scope[0].text).toBe("esphome:  # device-wide");
  });
});

/**
 * The exit walker pairs with ``computeStickyScope`` to give each
 * pinned row its slide-out anchor. The two have to agree on which
 * lines count as scope members (non-blank, non-banner-comment) —
 * a divergence here would let the row's slide window cross a
 * boundary where the chain is also re-computing, producing a
 * visible flicker rather than the smooth pixel-tracked slide.
 */
describe("findScopeExitLine", () => {
  it("returns the next sibling line for a list-item header", () => {
    // ``- platform: dht`` at indent 2 ends at the next line whose
    // indent is <= 2 — the next ``- platform:`` sibling at indent
    // 2. The slide-out window is anchored at that line's doc-y so
    // the dht row finishes sliding exactly as scrollTop crosses
    // into the gpio body.
    const lines = fromYaml(
      [
        "sensor:", //                  1   indent 0
        "  - platform: dht", //        2   indent 2  ← opener
        "    name: a", //              3   indent 4
        "  - platform: gpio", //       4   indent 2  ← exit
        "    name: b", //              5
      ].join("\n"),
    );
    expect(findScopeExitLine(lines, 2, 2)).toBe(4);
  });

  it("returns the next shallower-indent line for a deep scope", () => {
    // The exit is the FIRST line at the opener's indent OR LESS,
    // not just exact siblings. A row at indent 4 ends as soon as
    // any line drops back to indent 2 (or 0) — both are valid
    // exit candidates.
    const lines = fromYaml(
      [
        "binary_sensor:", //                       1   indent 0
        "  - platform: gpio", //                   2   indent 2
        "    on_press:", //                        3   indent 4  ← opener
        "      then:", //                          4   indent 6
        "        - logger.log: hi", //             5   indent 8
        "    on_release:", //                      6   indent 4  ← exit
      ].join("\n"),
    );
    expect(findScopeExitLine(lines, 3, 4)).toBe(6);
  });

  it("returns lines.length + 1 when the scope runs to EOF", () => {
    // No subsequent line is at indent <= 0, so the scope ``sensor:``
    // owns the rest of the doc. The sentinel (one past EOF) maps
    // to ``Infinity`` doc-y in the view-plugin — a never-sliding
    // row, which is the right behaviour for an EOF-anchored
    // scope (there's nothing below to slide into).
    const lines = fromYaml(
      [
        "sensor:", //                  1
        "  - platform: dht", //        2
        "    name: kitchen", //        3
      ].join("\n"),
    );
    expect(findScopeExitLine(lines, 1, 0)).toBe(lines.length + 1);
  });

  it("skips blank lines while searching for the exit", () => {
    // A blank line between sections doesn't end the scope on its
    // own — only an indent change does. Without this, a stray
    // blank inside a section would trigger a premature slide-out
    // and the chain would visibly flicker as scrollTop crossed
    // each blank.
    const lines = fromYaml(
      [
        "sensor:", //                  1   indent 0  ← opener
        "  - platform: dht", //        2   indent 2
        "    name: kitchen", //        3
        "", //                         4   blank — NOT the exit
        "  - platform: bme280", //     5   indent 2 — still inside scope
        "    name: living", //         6
        "switch:", //                  7   indent 0  ← exit
      ].join("\n"),
    );
    expect(findScopeExitLine(lines, 1, 0)).toBe(7);
  });

  it("skips column-0 banner comments while searching for the exit", () => {
    // ``## --- ##`` banners decorate the next section. They sit
    // at column 0 (so by raw indent they'd count as <= any
    // opener), but they're not a real exit — the next real key
    // at the same indent is. Same skip policy as
    // ``computeStickyScope`` keeps the chain and its exits
    // walking the same set of lines.
    const lines = fromYaml(
      [
        "esphome:", //                  1   indent 0  ← opener
        "  name: x", //                 2
        "## ---------- ##", //          3   column-0 banner — NOT the exit
        "## Components ##", //          4   column-0 banner — NOT the exit
        "sensor:", //                   5   indent 0  ← exit
      ].join("\n"),
    );
    expect(findScopeExitLine(lines, 1, 0)).toBe(5);
  });

  it("treats a same-indent next line as the exit", () => {
    // Indent is ``<= openerIndent`` (not strict less). A sibling
    // at the SAME indent ends the previous sibling's scope —
    // crucial for the slide window to fire at the right doc-y on
    // typical list-item layouts.
    const lines = fromYaml(
      [
        "  - platform: dht", //        1   indent 2  ← opener
        "    name: a", //              2
        "  - platform: gpio", //       3   indent 2  ← same indent = exit
      ].join("\n"),
    );
    expect(findScopeExitLine(lines, 1, 2)).toBe(3);
  });
});

/**
 * Slide-in companion to ``computeStickyScope`` — drives the
 * pixel-tracked appearance of a fresh sticky row as the topmost
 * rendered line crosses its own line height. Without the
 * predicate, a sibling-to-sibling transition would smoothly
 * slide-out the old row but then POP in the new one — the
 * visible asymmetry that reads as "imperfect timing" to the
 * user.
 */
describe("isScopeOpener", () => {
  it("returns true when the next line is at a deeper indent", () => {
    // ``sensor:`` (indent 0) is a scope opener — its body line
    // ``- platform: dht`` is at indent 2, strictly deeper.
    const lines = fromYaml(
      [
        "sensor:", //                  1   indent 0
        "  - platform: dht", //        2   indent 2
      ].join("\n"),
    );
    expect(isScopeOpener(lines, 1)).toBe(true);
  });

  it("returns false for a leaf line at the same indent as its next", () => {
    // ``name: x`` (indent 2) is a leaf — the next line is the
    // next sibling at the SAME indent, not a deeper child.
    const lines = fromYaml(
      [
        "esphome:", //                 1
        "  name: x", //                2   indent 2  ← leaf
        "  build_path: ./build", //    3   indent 2 (sibling, same indent)
      ].join("\n"),
    );
    expect(isScopeOpener(lines, 2)).toBe(false);
  });

  it("returns false for a top-level leaf", () => {
    // ``wifi:`` here has no children — next non-blank is the
    // next top-level key at the same indent. Not an opener.
    const lines = fromYaml(
      [
        "esphome:", //                 1
        "  name: x", //                2
        "wifi:", //                    3   indent 0  ← leaf
        "logger:", //                  4   indent 0
      ].join("\n"),
    );
    expect(isScopeOpener(lines, 3)).toBe(false);
  });

  it("skips blank lines when looking for the next meaningful line", () => {
    // A stray blank between the opener and its body shouldn't
    // change the answer — ``sensor:`` is still an opener even
    // with a blank between it and its first body line.
    const lines = fromYaml(
      [
        "sensor:", //                  1   indent 0
        "", //                         2   blank
        "  - platform: dht", //        3   indent 2
      ].join("\n"),
    );
    expect(isScopeOpener(lines, 1)).toBe(true);
  });

  it("skips column-0 banner comments when looking for the next line", () => {
    // ``## --- ##`` banners between sections shouldn't be
    // treated as the "next line" for opener detection — they
    // decorate the next section, not the surrounding scope.
    const lines = fromYaml(
      [
        "esphome:", //                 1   indent 0
        "## ----------- ##", //        2   column-0 banner
        "  name: x", //                3   indent 2  ← real next
      ].join("\n"),
    );
    expect(isScopeOpener(lines, 1)).toBe(true);
  });

  it("returns false at EOF when there's no next line", () => {
    // No subsequent line exists, so we can't claim the line
    // "opens" anything. Defensive — guards the slide-in append
    // from running for the last line of a doc.
    const lines = fromYaml(
      [
        "esphome:", //                 1
        "  name: x", //                2   ← last meaningful line
      ].join("\n"),
    );
    expect(isScopeOpener(lines, 2)).toBe(false);
  });

  it("returns false for blank and banner lines themselves", () => {
    // A blank or banner-comment ``lineNumber`` isn't itself a
    // meaningful line — it can't be a "scope opener" because
    // it doesn't open anything (it's not part of any scope).
    const lines = fromYaml(
      [
        "esphome:", //                 1
        "", //                         2   blank
        "## comment ##", //            3   banner
        "  name: x", //                4
      ].join("\n"),
    );
    expect(isScopeOpener(lines, 2)).toBe(false);
    expect(isScopeOpener(lines, 3)).toBe(false);
  });

  it("returns false for out-of-range line numbers", () => {
    const lines = fromYaml("esphome:\n  name: x\n");
    expect(isScopeOpener(lines, 0)).toBe(false);
    expect(isScopeOpener(lines, -1)).toBe(false);
    expect(isScopeOpener(lines, 9999)).toBe(false);
  });
});
