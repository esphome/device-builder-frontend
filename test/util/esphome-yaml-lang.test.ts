import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { getIndentation, indentUnit } from "@codemirror/language";
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
