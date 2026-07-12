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
  remoteBuildsEnabled: false,
  pairings: null,
};

describe("shouldShowOffloadHint", () => {
  it("shows for a slow local build with no offload set up", () => {
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

  it("stays hidden when remote builds are enabled", () => {
    expect(shouldShowOffloadHint({ ...base, remoteBuildsEnabled: true })).toBe(false);
  });

  it("stays hidden when a pairing already exists", () => {
    const pairings = new Map([["host:6052", {}]]);
    expect(shouldShowOffloadHint({ ...base, pairings })).toBe(false);
  });

  it("treats loading (null) context as not-set-up", () => {
    expect(
      shouldShowOffloadHint({ ...base, remoteBuildsEnabled: null, pairings: null })
    ).toBe(true);
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
