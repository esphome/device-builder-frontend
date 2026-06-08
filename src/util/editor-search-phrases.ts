import { EditorState, type Extension } from "@codemirror/state";

import type { LocalizeFunc } from "../common/localize.js";

/**
 * Localize CodeMirror's search / goto-line panel via the `phrases` facet.
 *
 * Keys are the verbatim source strings `@codemirror/search` looks up; keep
 * the `$` positional slot, which CodeMirror substitutes after lookup.
 */
export function editorSearchPhrases(localize: LocalizeFunc): Extension {
  return EditorState.phrases.of({
    Find: localize("editor_search.find"),
    Replace: localize("editor_search.replace_placeholder"),
    next: localize("editor_search.next"),
    previous: localize("editor_search.previous"),
    all: localize("editor_search.all"),
    "match case": localize("editor_search.match_case"),
    "by word": localize("editor_search.by_word"),
    regexp: localize("editor_search.regexp"),
    replace: localize("editor_search.replace"),
    "replace all": localize("editor_search.replace_all"),
    close: localize("editor_search.close"),
    "Go to line": localize("editor_search.go_to_line"),
    go: localize("editor_search.go"),
    "current match": localize("editor_search.current_match"),
    "on line": localize("editor_search.on_line"),
    "replaced $ matches": localize("editor_search.replaced_matches"),
    "replaced match on line $": localize("editor_search.replaced_match_on_line"),
  });
}
