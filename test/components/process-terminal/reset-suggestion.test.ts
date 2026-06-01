import { describe, expect, it, vi } from "vitest";
import {
  renderBuildFailureSuggestion,
  renderValidationFailureSuggestion,
  type SuggestionHost,
} from "../../../src/components/process-terminal/reset-suggestion.js";
import { findTemplatesByAnchor } from "../../_lit-template-walker.js";
import {
  expectLocalSuggestion,
  expectRemoteSuggestion,
  localize,
} from "../_reset-suggestion-helpers.js";

function makeHost(): SuggestionHost {
  return {
    _localize: localize,
    _tryOpenInEditor: vi.fn(),
    _tryCleanBuild: vi.fn(),
    _tryResetBuildEnv: vi.fn(),
  };
}

describe("shared reset-suggestion renderers", () => {
  it("validation failure wires the open-in-editor link", () => {
    const host = makeHost();
    const tree = renderValidationFailureSuggestion(host);
    const matches = findTemplatesByAnchor(tree, 'class="reset-suggestion"');
    expect(matches.length).toBe(1);
    expect(matches[0].values).toContain(host._tryOpenInEditor);
  });

  it("local build failure shows the clean + reset staircase", () => {
    const host = makeHost();
    expectLocalSuggestion(renderBuildFailureSuggestion(host, null), host);
  });

  it("remote build failure keeps clean, drops reset, inlines the receiver", () => {
    const host = makeHost();
    expectRemoteSuggestion(
      renderBuildFailureSuggestion(host, "Receiver A"),
      host,
      "Receiver A"
    );
  });
});
