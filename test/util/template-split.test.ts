/**
 * Tests for ``splitTemplate`` — the helper that slices a localized
 * template string by a sequence of placeholder tokens so renderers
 * can interleave Lit elements between the static chunks.
 *
 * Two call sites depend on the exact contract:
 *  - ``reset-suggestion.ts`` splits on ``{editor_action}`` (one
 *    placeholder → 2 chunks) and on ``{clean_action}`` /
 *    ``{reset_action}`` (two placeholders → 3 chunks).
 *  - ``remote-build-hint.ts`` splits on ``{clean_action}`` /
 *    ``{receiver}`` (two placeholders → 3 chunks).
 *
 * Both destructure the result with a fixed arity
 * (``const [before, middle, after] = ...``), so the load-bearing
 * invariant is: the array ALWAYS has ``placeholders.length + 1``
 * entries, in order, regardless of whether each placeholder is
 * actually present. A short array would leave ``after`` undefined
 * and render "undefined" into the DOM.
 */

import { describe, expect, it } from "vitest";
import { splitTemplate } from "../../src/util/template-split.js";

describe("splitTemplate", () => {
  it("splits a two-placeholder template into three ordered chunks", () => {
    // The reset-suggestion / remote-build-hint shape: text with two
    // distinct tokens that each get replaced by a button element.
    const result = splitTemplate(
      "Try {clean_action} first then {reset_action}.",
      "{clean_action}",
      "{reset_action}"
    );
    expect(result).toEqual(["Try ", " first then ", "."]);
  });

  it("splits a single-placeholder template into two chunks", () => {
    // The reset-suggestion ``{editor_action}`` shape.
    const result = splitTemplate("Open {editor_action} to edit.", "{editor_action}");
    expect(result).toEqual(["Open ", " to edit."]);
  });

  it("preserves leading and trailing placeholders as empty chunks", () => {
    // A token at the very start yields a leading "" chunk; a token
    // at the very end yields a trailing "" chunk. Renderers rely on
    // these empty strings so the element lands flush against the
    // surrounding text.
    expect(splitTemplate("{x}tail", "{x}")).toEqual(["", "tail"]);
    expect(splitTemplate("head{x}", "{x}")).toEqual(["head", ""]);
    expect(splitTemplate("{x}", "{x}")).toEqual(["", ""]);
  });

  it("always returns placeholders.length + 1 entries", () => {
    // The arity guarantee the destructuring call sites depend on.
    expect(splitTemplate("plain")).toHaveLength(1);
    expect(splitTemplate("a{x}b", "{x}")).toHaveLength(2);
    expect(splitTemplate("a{x}b{y}c", "{x}", "{y}")).toHaveLength(3);
    expect(splitTemplate("a{x}b{y}c{z}d", "{x}", "{y}", "{z}")).toHaveLength(4);
  });

  it("returns the whole template as a single chunk when no placeholders are given", () => {
    expect(splitTemplate("nothing to split")).toEqual(["nothing to split"]);
  });

  it("fills an absent placeholder's slot rather than dropping it", () => {
    // If a token never appears in the template, the helper still
    // emits the full arity: the text accumulates in the chunk
    // before the missing token and the trailing slot is "". This is
    // what keeps ``const [before, after] = ...`` safe even when a
    // translator drops a placeholder from a locale string.
    expect(splitTemplate("no tokens here", "{x}")).toEqual(["no tokens here", ""]);
    // Two placeholders, only the first present: the second slot is
    // empty and the arity stays at 3.
    expect(splitTemplate("a{x}b", "{x}", "{y}")).toEqual(["a", "b", ""]);
    // Two placeholders, neither present: everything stays in the
    // first chunk, the remaining slots are empty.
    expect(splitTemplate("plain", "{x}", "{y}")).toEqual(["plain", "", ""]);
  });

  it("drops the tail past the first occurrence of a repeated placeholder", () => {
    // The helper's distinct-token contract: ``[head, tail=""] =
    // rest.split(ph)`` keeps only the first two segments, so a
    // repeated token discards everything after the 2nd segment
    // (here ``c`` is lost). Call sites use unique tokens, so this
    // is a documented limitation, not a path they hit.
    expect(splitTemplate("a{x}b{x}c", "{x}")).toEqual(["a", "b"]);
  });

  it("handles an empty template", () => {
    expect(splitTemplate("")).toEqual([""]);
    expect(splitTemplate("", "{x}")).toEqual(["", ""]);
  });

  it("reassembles the original text when tokens are interleaved with the chunks", () => {
    // Round-trip invariant: zipping the chunks back together with
    // their placeholders reproduces the source template. This is
    // exactly what the renderers do (chunk, element, chunk, ...),
    // so it pins the property the UI actually depends on.
    const template = "Press {a} then {b} to finish.";
    const placeholders = ["{a}", "{b}"];
    const parts = splitTemplate(template, ...placeholders);
    let rebuilt = parts[0];
    for (let i = 0; i < placeholders.length; i++) {
      rebuilt += placeholders[i] + parts[i + 1];
    }
    expect(rebuilt).toBe(template);
  });
});
