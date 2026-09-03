import { describe, expect, it } from "vitest";
import {
  endsBlockAtIndent,
  IGNORED_TOP_LEVEL_KEY_RE,
  TOP_LEVEL_KEY_RE,
  TOP_LEVEL_KEY_START_RE,
} from "../../src/util/yaml-section-lexer.js";

describe("dot-prefixed top-level keys", () => {
  it("terminate the previous block but are not sections themselves", () => {
    expect(TOP_LEVEL_KEY_START_RE.test(".defaultfilters:")).toBe(true);
    expect(IGNORED_TOP_LEVEL_KEY_RE.test(".defaultfilters:")).toBe(true);
    expect(TOP_LEVEL_KEY_RE.test(".defaultfilters:")).toBe(false);
  });

  it("are only recognised at column 0 with a key shape", () => {
    expect(IGNORED_TOP_LEVEL_KEY_RE.test("  .indented:")).toBe(false);
    expect(IGNORED_TOP_LEVEL_KEY_RE.test(".no_colon")).toBe(false);
    expect(TOP_LEVEL_KEY_START_RE.test("  wifi:")).toBe(false);
  });
});

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
