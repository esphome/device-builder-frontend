import { describe, expect, it } from "vitest";
import { diffLines, hasChanges, type DiffLine } from "../../src/util/diff-lines.js";

/**
 * Reconstruct the old document from a diff: the lines visible on the
 * "old" side are the `context` + `remove` rows, in order. Mirrors how
 * `yaml-diff` paints the left gutter. A correct diff must round-trip
 * back to the original input through this.
 */
function reconstructOld(diff: DiffLine[]): string {
  return diff
    .filter((l) => l.type === "context" || l.type === "remove")
    .map((l) => l.content)
    .join("\n");
}

/** Same idea for the "new" side: `context` + `add` rows. */
function reconstructNew(diff: DiffLine[]): string {
  return diff
    .filter((l) => l.type === "context" || l.type === "add")
    .map((l) => l.content)
    .join("\n");
}

describe("diffLines", () => {
  it("marks every line as context when the texts are identical", () => {
    const diff = diffLines("a\nb\nc", "a\nb\nc");
    expect(diff).toEqual([
      { type: "context", oldLine: 1, newLine: 1, content: "a" },
      { type: "context", oldLine: 2, newLine: 2, content: "b" },
      { type: "context", oldLine: 3, newLine: 3, content: "c" },
    ]);
  });

  it("treats two empty strings as a single empty context line", () => {
    // `"".split("\n")` is `[""]`, so the empty document is one empty
    // line rather than zero lines — both sides agree, so it's context.
    expect(diffLines("", "")).toEqual([
      { type: "context", oldLine: 1, newLine: 1, content: "" },
    ]);
  });

  it("emits only adds when content is appended to the end", () => {
    const diff = diffLines("a", "a\nb");
    expect(diff).toEqual([
      { type: "context", oldLine: 1, newLine: 1, content: "a" },
      { type: "add", newLine: 2, content: "b" },
    ]);
    // `oldLine` is left undefined on pure additions — the old side has
    // no row to number.
    expect(diff[1].oldLine).toBeUndefined();
  });

  it("emits only removes when content is deleted from the end", () => {
    const diff = diffLines("a\nb", "a");
    expect(diff).toEqual([
      { type: "context", oldLine: 1, newLine: 1, content: "a" },
      { type: "remove", oldLine: 2, content: "b" },
    ]);
    expect(diff[1].newLine).toBeUndefined();
  });

  it("represents a single-line edit as a remove followed by an add", () => {
    // A changed line isn't a "modify" row — it's the old line removed
    // and the new line added, which is what the LCS reconstruction
    // produces (remove before add for the same position).
    const diff = diffLines("a\nb\nc", "a\nx\nc");
    expect(diff).toEqual([
      { type: "context", oldLine: 1, newLine: 1, content: "a" },
      { type: "remove", oldLine: 2, content: "b" },
      { type: "add", newLine: 2, content: "x" },
      { type: "context", oldLine: 3, newLine: 3, content: "c" },
    ]);
  });

  it("keeps shared context around an inserted block", () => {
    const diff = diffLines("a\nc", "a\nb\nc");
    expect(diff).toEqual([
      { type: "context", oldLine: 1, newLine: 1, content: "a" },
      { type: "add", newLine: 2, content: "b" },
      { type: "context", oldLine: 2, newLine: 3, content: "c" },
    ]);
  });

  it("numbers old and new lines independently across a hunk", () => {
    // After an insertion the new-side numbering runs ahead of the
    // old-side numbering; both must stay monotonic on their own axis.
    const diff = diffLines("x\ny", "x\nINSERTED\ny\nz");
    const oldNums = diff.filter((l) => l.oldLine !== undefined).map((l) => l.oldLine);
    const newNums = diff.filter((l) => l.newLine !== undefined).map((l) => l.newLine);
    expect(oldNums).toEqual([1, 2]);
    expect(newNums).toEqual([1, 2, 3, 4]);
  });

  it("round-trips: context+remove rebuilds old, context+add rebuilds new", () => {
    const cases: Array<[string, string]> = [
      ["a\nb\nc\nd", "a\nx\nc\ny\nd"],
      ["one\ntwo\nthree", "zero\none\nthree\nfour"],
      ["", "line"],
      ["line", ""],
      ["same\nsame\nsame", "same\nsame\nsame"],
      ["a\nb\nc", "c\nb\na"],
    ];
    for (const [oldText, newText] of cases) {
      const diff = diffLines(oldText, newText);
      expect(reconstructOld(diff)).toBe(oldText);
      expect(reconstructNew(diff)).toBe(newText);
    }
  });

  it("does not collapse adjacent blank lines into a shorter diff", () => {
    // Blank lines are real lines for the diff — removing one of three
    // blanks must surface exactly one `remove`, not silently vanish.
    const diff = diffLines("\n\n\n", "\n\n");
    expect(diff.filter((l) => l.type === "remove")).toHaveLength(1);
    expect(reconstructOld(diff)).toBe("\n\n\n");
    expect(reconstructNew(diff)).toBe("\n\n");
  });
});

describe("hasChanges", () => {
  it("is false for byte-identical text", () => {
    expect(hasChanges("a\nb", "a\nb")).toBe(false);
    expect(hasChanges("", "")).toBe(false);
  });

  it("is true when the texts differ", () => {
    expect(hasChanges("a\nb", "a\nc")).toBe(true);
    expect(hasChanges("a", "a\n")).toBe(true);
    expect(hasChanges("", " ")).toBe(true);
  });
});
