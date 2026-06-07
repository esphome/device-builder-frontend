import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  sensitiveValueMaskExtension,
  setRevealSensitiveEffect,
} from "../../src/util/yaml-sensitive-mask.js";

/**
 * Collect the substrings of `doc` that the mask extension decorates
 * in the given `state`. The decoration field is provided to the
 * `EditorView.decorations` facet, so we can read it from plain state
 * (no DOM / EditorView mount needed — vitest runs in the node env).
 */
function maskedSlices(state: EditorState): string[] {
  const doc = state.doc.toString();
  const out: string[] = [];
  for (const value of state.facet(EditorView.decorations)) {
    if (typeof value === "function") continue;
    const cursor = value.iter();
    while (cursor.value) {
      out.push(doc.slice(cursor.from, cursor.to));
      cursor.next();
    }
  }
  return out;
}

function makeState(doc: string, extension: Extension): EditorState {
  return EditorState.create({ doc, extensions: [extension] });
}

describe("sensitiveValueMaskExtension", () => {
  it("masks an inline credential value, leaving the key visible", () => {
    const state = makeState("api:\n  password: hunter2\n", sensitiveValueMaskExtension());
    expect(maskedSlices(state)).toEqual(["hunter2"]);
  });

  it("masks the value only, excluding a trailing inline comment", () => {
    const state = makeState(
      "api:\n  password: hunter2 # prod key\n",
      sensitiveValueMaskExtension()
    );
    expect(maskedSlices(state)).toEqual(["hunter2"]);
  });

  it("passes !secret indirection lines through unmasked", () => {
    // The value is the *name* of a secret, not the credential, so it
    // must stay readable.
    const state = makeState(
      "api:\n  password: !secret api_pw\n",
      sensitiveValueMaskExtension()
    );
    expect(maskedSlices(state)).toEqual([]);
  });

  it("masks every credential line in a multi-line document", () => {
    const state = makeState(
      [
        "wifi:",
        "  ap:",
        "    password: ap-secret",
        "ota:",
        "  password: ota-secret",
        "",
      ].join("\n"),
      sensitiveValueMaskExtension()
    );
    expect(maskedSlices(state).sort()).toEqual(["ap-secret", "ota-secret"]);
  });

  it("does not mask non-credential values by default", () => {
    const state = makeState(
      "esphome:\n  name: my-device\n",
      sensitiveValueMaskExtension()
    );
    expect(maskedSlices(state)).toEqual([]);
  });

  it("masks arbitrary values when maskAllValues is set (secrets editor)", () => {
    const state = makeState(
      "wifi_password: topsecret\napi_key: abc123\n",
      sensitiveValueMaskExtension(false, true)
    );
    expect(maskedSlices(state).sort()).toEqual(["abc123", "topsecret"]);
  });

  it("produces no decorations when constructed already revealed", () => {
    const state = makeState(
      "api:\n  password: hunter2\n",
      sensitiveValueMaskExtension(true)
    );
    expect(maskedSlices(state)).toEqual([]);
  });

  it("clears all decorations when the reveal effect flips on", () => {
    const start = makeState("api:\n  password: hunter2\n", sensitiveValueMaskExtension());
    expect(maskedSlices(start)).toEqual(["hunter2"]);

    const revealed = start.update({
      effects: setRevealSensitiveEffect.of(true),
    }).state;
    expect(maskedSlices(revealed)).toEqual([]);
  });

  it("re-masks when the reveal effect flips back off", () => {
    const masked = makeState(
      "api:\n  password: hunter2\n",
      sensitiveValueMaskExtension(true)
    );
    expect(maskedSlices(masked)).toEqual([]);

    const reMasked = masked.update({
      effects: setRevealSensitiveEffect.of(false),
    }).state;
    expect(maskedSlices(reMasked)).toEqual(["hunter2"]);
  });

  it("recomputes decorations after a document edit adds a credential", () => {
    const before = makeState("api:\n", sensitiveValueMaskExtension());
    expect(maskedSlices(before)).toEqual([]);

    const after = before.update({
      changes: { from: before.doc.length, insert: "  password: hunter2\n" },
    }).state;
    expect(maskedSlices(after)).toEqual(["hunter2"]);
  });

  it("drops the mask when a credential value is deleted", () => {
    const doc = "api:\n  password: hunter2\n";
    const before = makeState(doc, sensitiveValueMaskExtension());
    expect(maskedSlices(before)).toEqual(["hunter2"]);

    // Remove the value text, leaving `  password: ` with nothing after.
    const valueFrom = doc.indexOf("hunter2");
    const after = before.update({
      changes: { from: valueFrom, to: valueFrom + "hunter2".length, insert: "" },
    }).state;
    expect(maskedSlices(after)).toEqual([]);
  });
});
