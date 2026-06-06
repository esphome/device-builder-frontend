import { describe, expect, it } from "vitest";
import { endsBlockAtIndent } from "../../src/util/yaml-section-lexer.js";

describe("endsBlockAtIndent", () => {
  // The single source of truth for "where does a block end", shared by
  // every block-boundary scan (_findBlockEnd, _scanValueBlock, findFieldLine).
  const OPENER = 2; // a key at two columns, e.g. ``  areas:``

  it("never ends on blank or comment-only lines", () => {
    expect(endsBlockAtIndent("", OPENER)).toBe(false);
    expect(endsBlockAtIndent("   ", OPENER)).toBe(false);
    expect(endsBlockAtIndent("# banner", OPENER)).toBe(false);
    expect(endsBlockAtIndent("    # indented note", OPENER)).toBe(false);
  });

  it("keeps deeper-indented body lines in the block", () => {
    expect(endsBlockAtIndent("      number: 33", OPENER)).toBe(false);
  });

  it("ends on a shallower line (back-out) or a same-indent sibling key", () => {
    expect(endsBlockAtIndent("name: x", OPENER)).toBe(true); // shallower
    expect(endsBlockAtIndent("  id: x", OPENER)).toBe(true); // same-indent non-dash
  });

  it("continues on a same-indent compact block-sequence dash, bare or with content", () => {
    expect(endsBlockAtIndent("  - name: zombie", OPENER)).toBe(false);
    expect(endsBlockAtIndent("  -", OPENER)).toBe(false);
  });

  it("ends on a same-indent line that only looks like a dash (e.g. -name)", () => {
    expect(endsBlockAtIndent("  -name: x", OPENER)).toBe(true);
  });
});
