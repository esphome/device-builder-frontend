import { describe, expect, it, vi } from "vitest";
import { JobSource } from "../../../src/api/types/firmware-jobs.js";
import {
  OFFLOAD_HINT_THRESHOLD_MS,
  renderOffloadHint,
  shouldShowOffloadHint,
} from "../../../src/components/process-terminal/offload-hint.js";
import { findTemplatesByAnchor } from "../../_lit-template-walker.js";
import { localize } from "../_reset-suggestion-helpers.js";

const OVER = OFFLOAD_HINT_THRESHOLD_MS + 1;
const UNDER = OFFLOAD_HINT_THRESHOLD_MS - 1;

const base = {
  elapsedMs: OVER,
  source: JobSource.LOCAL,
  pairings: null,
};

describe("shouldShowOffloadHint", () => {
  it("shows for a slow local build with no build server paired", () => {
    expect(shouldShowOffloadHint(base)).toBe(true);
  });

  it("stays hidden below the threshold", () => {
    expect(shouldShowOffloadHint({ ...base, elapsedMs: UNDER })).toBe(false);
  });

  it("stays hidden for a remote build", () => {
    expect(shouldShowOffloadHint({ ...base, source: JobSource.REMOTE })).toBe(false);
    expect(shouldShowOffloadHint({ ...base, source: JobSource.REMOTE_PENDING })).toBe(
      false
    );
  });

  it("stays hidden when a build server is paired", () => {
    const pairings = new Map([["host:6052", {}]]);
    expect(shouldShowOffloadHint({ ...base, pairings })).toBe(false);
  });

  it("still shows on a default dashboard (auto-route toggle is not consulted)", () => {
    // remote_builds_enabled defaults on; gating on it would hide the nudge
    // from everyone, so only an actual pairing suppresses it.
    expect(shouldShowOffloadHint({ ...base, pairings: null })).toBe(true);
    expect(shouldShowOffloadHint({ ...base, pairings: new Map() })).toBe(true);
  });
});

describe("renderOffloadHint", () => {
  it("wires the open-settings button", () => {
    const host = { _localize: localize, _tryOpenBuildOffloadSettings: vi.fn() };
    const tree = renderOffloadHint(host);
    const matches = findTemplatesByAnchor(tree, 'class="reset-suggestion"');
    expect(matches.length).toBe(1);
    expect(matches[0].values).toContain(host._tryOpenBuildOffloadSettings);
  });
});
