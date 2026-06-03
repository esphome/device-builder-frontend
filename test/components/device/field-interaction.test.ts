import { describe, expect, it } from "vitest";
import { decideFieldFocus } from "../../../src/components/device/field-interaction.js";

const A = '["a"]';
const B = '["b"]';

describe("decideFieldFocus", () => {
  it("focusin emits and becomes the focused field", () => {
    expect(decideFieldFocus("focusin", A, undefined)).toEqual({
      emit: true,
      focusedKey: A,
    });
  });

  it("focusin re-focusing the same field still emits (harmless re-assert)", () => {
    expect(decideFieldFocus("focusin", A, A)).toEqual({ emit: true, focusedKey: A });
  });

  it("input on a newly-edited field emits and claims focus (missed focusin)", () => {
    // The areas/globals id bug: a just-added required input whose focusin
    // didn't surface — typing in it must still highlight it.
    expect(decideFieldFocus("input", B, A)).toEqual({ emit: true, focusedKey: B });
  });

  it("input while mid-typing in the focused field does not re-emit", () => {
    expect(decideFieldFocus("input", A, A)).toEqual({ emit: false, focusedKey: A });
  });

  it("change on the focused field emits", () => {
    expect(decideFieldFocus("change", A, A)).toEqual({ emit: true, focusedKey: A });
  });

  it("change on a field that already lost focus is dropped (blur re-point)", () => {
    // Moving A->B: A's blur-time change must not re-point the highlight at A.
    expect(decideFieldFocus("change", A, B)).toEqual({ emit: false, focusedKey: B });
  });
});
