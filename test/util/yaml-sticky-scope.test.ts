import { describe, expect, it } from "vitest";
import { computeStickyScope } from "../../src/util/yaml-sticky-scope.js";

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
      ].join("\n")
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
