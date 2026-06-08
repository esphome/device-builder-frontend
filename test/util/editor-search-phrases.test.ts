import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import type { LocalizeFunc } from "../../src/common/localize.js";
import { editorSearchPhrases } from "../../src/util/editor-search-phrases.js";

/** Echoes the key so each phrase resolves to its own translation key. */
const echo: LocalizeFunc = (key) => key;

function phraseState(localize: LocalizeFunc): EditorState {
  return EditorState.create({ extensions: [editorSearchPhrases(localize)] });
}

describe("editorSearchPhrases", () => {
  it("maps every CodeMirror search source string to a translation", () => {
    const state = phraseState(echo);
    expect(state.phrase("Find")).toBe("editor_search.find");
    expect(state.phrase("Replace")).toBe("editor_search.replace_placeholder");
    expect(state.phrase("next")).toBe("editor_search.next");
    expect(state.phrase("previous")).toBe("editor_search.previous");
    expect(state.phrase("all")).toBe("editor_search.all");
    expect(state.phrase("match case")).toBe("editor_search.match_case");
    expect(state.phrase("by word")).toBe("editor_search.by_word");
    expect(state.phrase("regexp")).toBe("editor_search.regexp");
    expect(state.phrase("replace")).toBe("editor_search.replace");
    expect(state.phrase("replace all")).toBe("editor_search.replace_all");
    expect(state.phrase("close")).toBe("editor_search.close");
    expect(state.phrase("Go to line")).toBe("editor_search.go_to_line");
    expect(state.phrase("go")).toBe("editor_search.go");
    expect(state.phrase("current match")).toBe("editor_search.current_match");
    expect(state.phrase("on line")).toBe("editor_search.on_line");
  });

  it("keeps CodeMirror's $ positional slot so announcements interpolate", () => {
    // CM substitutes $ after lookup, so the value must keep its $.
    const state = phraseState((key) =>
      key === "editor_search.replaced_matches" ? "replaced $ matches" : key
    );
    expect(state.phrase("replaced $ matches", 3)).toBe("replaced 3 matches");
  });

  it("returns the localized value, not the source string", () => {
    const state = phraseState((key) => key.replace("editor_search.", "x-"));
    expect(state.phrase("next")).toBe("x-next");
  });
});
