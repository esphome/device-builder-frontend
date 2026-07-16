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
    _tryResetRemoteBuildEnv: vi.fn(),
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

  it("remote failure with a reset-capable receiver offers the remote reset", () => {
    const host = makeHost();
    const pin = "a".repeat(64);
    const tree = renderBuildFailureSuggestion(host, "Receiver A", pin);
    const matches = findTemplatesByAnchor(tree, 'class="reset-suggestion"');
    expect(matches.length).toBe(1);
    const values = matches[0].values;
    expect(values).toContain(host._tryCleanBuild);
    // The local reset link stays out; the remote-reset click handler is an
    // inline closure over the pin, so invoke it and assert the delegation.
    expect(values).not.toContain(host._tryResetBuildEnv);
    const remoteClick = values.find(
      (v): v is () => void => typeof v === "function" && v !== host._tryCleanBuild
    );
    expect(remoteClick).toBeDefined();
    remoteClick?.();
    expect(host._tryResetRemoteBuildEnv).toHaveBeenCalledWith(pin);
  });
});
