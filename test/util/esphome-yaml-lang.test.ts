import {
  ensureSyntaxTree,
  foldable,
  getIndentation,
  IndentContext,
  indentUnit,
} from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { ESPHOME_YAML_INDENT, esphomeYaml } from "../../src/util/esphome-yaml-lang.js";

/**
 * The indent service mirrors the legacy esphome dashboard's Monaco
 * rule (`beforeText: /:\s*$/` → Indent) plus list-item continuation
 * handling. Pin both the trailing-colon and dash-continuation paths
 * so a future refactor can't quietly drop them.
 *
 * `getIndentation` is CodeMirror's official entry point for asking
 * the registered indent services for the indent of a given position
 * — using it (rather than reaching into the service callback
 * directly) keeps the test resilient to internal API changes.
 */
function indentAt(yaml: string): number | null {
  // Pin ``indentUnit`` to ``ESPHOME_YAML_INDENT`` — same shared
  // constant the editor wires up — so assertions below are
  // deterministic and don't drift with CodeMirror's default.
  const state = EditorState.create({
    doc: yaml,
    extensions: [indentUnit.of(ESPHOME_YAML_INDENT), esphomeYaml()],
  });
  // Indent the LAST line of the doc — that's what gets recomputed
  // when the user presses Enter at the end of a content line.
  const lastLine = state.doc.line(state.doc.lines);
  return getIndentation(state, lastLine.from);
}

describe("esphome-yaml indent service", () => {
  it("indents +2 after a trailing-colon block opener", () => {
    // After `esphome:`, the next line should sit at indent 2.
    expect(indentAt("esphome:\n")).toBe(2);
  });

  it("continues at parent indent for content lines", () => {
    // After `name: test`, the next line should match `name:`'s indent
    // (2 — sibling key under `esphome:`), not jump deeper.
    expect(indentAt("esphome:\n  name: test\n")).toBe(2);
  });

  it("indents +2 after nested trailing-colon", () => {
    // `esphome:` → indent 2. `on_boot:` at indent 2 → next line at
    // indent 4. Confirms the rule fires regardless of nesting depth.
    expect(indentAt("esphome:\n  on_boot:\n")).toBe(4);
  });

  it("aligns continuation lines under a list-item dash", () => {
    // `  - platform: template` → siblings of `platform` should land
    // at column 4 (dash position 2 + 2). Without this, the next line
    // would default to column 2 and look like a new list item.
    expect(indentAt("button:\n  - platform: template\n")).toBe(4);
  });

  it("combines list-item continuation with trailing-colon", () => {
    // `  - on_press:` → next line at column 6 (dash + 2 + 2 for the
    // colon child block). Mirrors the user's expected shape:
    //   button:
    //     - on_press:
    //         then:
    expect(indentAt("button:\n  - on_press:\n")).toBe(6);
  });

  it("walks back over blank lines to the last non-blank", () => {
    // A blank line between sections shouldn't reset indent — the
    // editor should still honour the last meaningful predecessor.
    expect(indentAt("esphome:\n  on_boot:\n\n")).toBe(4);
  });

  it("strips inline trailing comments before checking trailing colon", () => {
    // `key:  # note` is still a block opener — the legacy dashboard
    // didn't strip comments and would've missed this. Pinning the
    // strip avoids regressing.
    expect(indentAt("esphome:  # device-wide config\n")).toBe(2);
  });

  it("returns 0 for top-level content lines", () => {
    // After `esphome: test`, the next line is a top-level sibling
    // → indent 0. (Yes, that's malformed YAML; we still want the
    // editor to behave gracefully.)
    expect(indentAt("esphome: test\n")).toBe(0);
  });

  it("indents +step after a block-scalar header", () => {
    // ``lambda: |-`` opens a block scalar; the next line is its
    // content and should land one step deeper than the key.
    // Mirrors the ESPHome ``lambda: |-`` / ``!lambda |-`` shape
    // — without this users have to hand-indent every C++ line.
    expect(indentAt("on_boot:\n  - lambda: |-\n")).toBe(6);
    expect(indentAt("foo:\n  bar: >+\n")).toBe(4);
    expect(indentAt("foo:\n  bar: |\n")).toBe(4);
  });
});

/**
 * Reproduce the real Enter flow: `insertNewlineAndIndent` calls
 * `getIndentation` with `pos` at the END of the current line plus a
 * `simulateBreak` there — it does NOT move `pos` to a new empty line. The
 * `indentAt` helper above masks that by ending the doc in `\n`; this one
 * pins the actual keypress so the #744 off-by-one can't come back.
 */
function indentOnEnter(yaml: string): number | null {
  const state = EditorState.create({
    doc: yaml,
    extensions: [indentUnit.of(ESPHOME_YAML_INDENT), esphomeYaml()],
  });
  const pos = state.doc.length; // cursor at the end of the last content line
  const cx = new IndentContext(state, { simulateBreak: pos });
  return getIndentation(cx, pos);
}

describe("esphome-yaml auto-indent on Enter (simulated break)", () => {
  it("indents +step after a top-level colon", () => {
    expect(indentOnEnter("wifi:")).toBe(2);
  });

  it("indents +step under a nested colon", () => {
    expect(indentOnEnter("wifi:\n  networks:")).toBe(4);
  });

  it("aligns a continuation under a list-item dash", () => {
    expect(indentOnEnter("button:\n  - platform: a")).toBe(4);
  });

  it("combines list-item dash with a trailing colon", () => {
    expect(indentOnEnter("button:\n  - on_press:")).toBe(6);
  });

  it("keeps a content line at its sibling indent", () => {
    expect(indentOnEnter("esphome:\n  name: x")).toBe(2);
  });

  it("returns 0 after a top-level content line", () => {
    expect(indentOnEnter("esphome: test")).toBe(0);
  });
});

/**
 * `foldable` is CodeMirror's official query for the fold range a given
 * line opens — using it (rather than reading the parser props directly)
 * keeps the test resilient to internal API changes. Returns `{from, to}`
 * for the collapsible region, or `null` when the line opens nothing.
 */
function foldAt(yaml: string, lineNumber: number): { from: number; to: number } | null {
  const state = EditorState.create({
    doc: yaml,
    extensions: [indentUnit.of(ESPHOME_YAML_INDENT), esphomeYaml()],
  });
  // Force a full parse so the fold service sees the whole tree.
  ensureSyntaxTree(state, state.doc.length);
  const line = state.doc.line(lineNumber);
  return foldable(state, line.from, line.to);
}

describe("esphome-yaml folding", () => {
  it("folds a top-level block from the end of its opening line", () => {
    const yaml = "wifi:\n  ssid: x\n  password: y\n";
    const range = foldAt(yaml, 1);
    expect(range).not.toBeNull();
    // Fold starts at the end of the `wifi:` line, not the start — the
    // header stays visible when collapsed.
    expect(range!.from).toBe(yaml.indexOf("\n"));
    // ...and extends through the last child line.
    expect(range!.to).toBe("wifi:\n  ssid: x\n  password: y".length);
  });

  it("does not fold a leaf key with no children", () => {
    expect(foldAt("wifi:\n  ssid: x\n", 2)).toBeNull();
  });

  it("folds a list section", () => {
    const yaml = "sensor:\n  - platform: dht\n    pin: D1\n";
    expect(foldAt(yaml, 1)).not.toBeNull();
  });
});

describe("esphome-yaml language extension shape", () => {
  it("ships an indent service in the support bundle", () => {
    // Cheap structural check — surfaces a regression if someone
    // refactors the export and forgets to pass the indent service
    // along to LanguageSupport.
    const support = esphomeYaml();
    expect(support).toBeTruthy();
    expect(support.support).toBeDefined();
    // The support bundle includes our indentService.of(...) plus
    // whatever the language carries; both are Extension values, so
    // a positive length is enough confirmation.
    const flat = ([] as unknown[]).concat(support.support as unknown[]);
    expect(flat.length).toBeGreaterThan(0);
  });
});

describe("esphome-yaml lambda C++ overlay", () => {
  // Forcing a full parse runs parseMixed; an empty `!lambda` value (the shape
  // produced the instant the Value/λ Lambda toggle is flipped, before any code
  // is typed) used to overlay a zero-length C++ range and crash checkRanges.
  const parse = (yaml: string): void => {
    const state = EditorState.create({
      doc: yaml,
      extensions: [indentUnit.of(ESPHOME_YAML_INDENT), esphomeYaml()],
    });
    ensureSyntaxTree(state, state.doc.length);
  };

  it("does not crash on an empty block lambda", () => {
    expect(() =>
      parse("mdns:\n  services:\n    - txt:\n        new_1: !lambda |-\n")
    ).not.toThrow();
  });

  it("does not crash on an empty quoted lambda", () => {
    expect(() =>
      parse("sensor:\n  - filters:\n      - lambda: !lambda ''\n")
    ).not.toThrow();
  });

  it("does not crash on a bare !lambda with no value node", () => {
    // The instant the toggle flips, before any code is typed, the tag has
    // no value child at all — lambdaSpan returns null, no overlay.
    expect(() => parse("x: !lambda\n")).not.toThrow();
  });

  it("still parses a non-empty block lambda without throwing", () => {
    expect(() =>
      parse("light:\n  - on_turn_on:\n      - lambda: !lambda |-\n          return 1;\n")
    ).not.toThrow();
  });
});
