import { describe, expect, it } from "vitest";
import {
  computeStickyScope,
  findScopeExitLine,
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
      ].join("\n")
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
      ].join("\n")
    );
    expect(computeStickyScope(lines, 3)).toEqual([]);
  });

  it("collects a single parent for a one-deep nested line", () => {
    const lines = fromYaml(
      [
        "esphome:", //         1
        "  name: x", //        2   ← top visible, leaf at indent 2
      ].join("\n")
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
      ].join("\n")
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
      ].join("\n")
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
      ].join("\n")
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
      ].join("\n")
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
      ].join("\n")
    );
    const scope = computeStickyScope(lines, 6);
    expect(scope.map((s) => s.lineNumber)).toEqual([5]);
  });

  it("starts the walk from indent of a blank top-visible line", () => {
    // A blank top-visible line adopts the indent of the most recent
    // meaningful line above it, so the chain stays stable as scrollTop
    // crosses a blank inside a scope. (Boundary handling — dropping a
    // finished scope as the next sibling arrives — is the overlay's job
    // in ``measure()`` via the Monaco slide, not this text walker.)
    const lines = fromYaml(
      [
        "sensor:", //                  1
        "  - platform: dht", //        2
        "    name: kitchen", //        3
        "", //                         4   ← top visible (blank)
        "  - platform: bme280", //     5
      ].join("\n")
    );
    const scope = computeStickyScope(lines, 4);
    // Previous meaningful line is 3 (indent 4); its strictly-less-indented
    // ancestors are the dht ``- platform`` (2) and ``sensor:`` (1).
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
      ].join("\n")
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
      ].join("\n")
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
      ].join("\n")
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
      ].join("\n")
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
      ].join("\n")
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
      ].join("\n")
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
      ].join("\n")
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
      ].join("\n")
    );
    expect(findScopeExitLine(lines, 1, 2)).toBe(3);
  });

  it("returns the EOF sentinel when the exit is past searchTo (off-screen)", () => {
    // The sticky overlay only cares about an exit within the rendered
    // viewport; bounding the scan with searchTo lets a far-below exit
    // read as off-screen (lines.length + 1) without scanning to it.
    const lines = fromYaml(
      [
        "sensor:", //        1   indent 0  ← opener
        "  - a: 1", //       2   indent 2
        "  - b: 2", //       3   indent 2
        "  - c: 3", //       4   indent 2
        "other:", //         5   indent 0  ← real exit, but below searchTo
      ].join("\n")
    );
    // Unbounded: real exit at line 5.
    expect(findScopeExitLine(lines, 1, 0)).toBe(5);
    // Bounded to line 3: exit not within window → off-screen sentinel.
    expect(findScopeExitLine(lines, 1, 0, 1, 3)).toBe(lines.length + 1);
  });

  it("skips lines before searchFrom (exit known to be at/after it)", () => {
    const lines = fromYaml(
      [
        "sensor:", //        1   indent 0  ← opener (far above)
        "  - a: 1", //       2
        "  - b: 2", //       3   ← top visible line (searchFrom)
        "light:", //         4   indent 0  ← exit
      ].join("\n")
    );
    expect(findScopeExitLine(lines, 1, 0, 3, lines.length)).toBe(4);
  });
});
