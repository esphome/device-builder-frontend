/**
 * Tests for the install/compile failure hint branching between local and
 * remote build sources.
 *
 * The local branch keeps both clean + reset links because
 * ``firmware/reset_build_env`` actually wipes the local toolchain cache.
 * The remote branch drops the reset link (it only wipes the *offloader's*
 * cache — useless when the broken cache is on the paired receiver) and
 * substitutes a plain-text "ask the operator of <peer>" instruction with
 * the receiver label inlined.
 */
import { describe, expect, it } from "vitest";
import enMessages from "../../src/translations/en.json";
import { renderResetSuggestion } from "../../src/components/command-dialog/renderers.js";
import {
  JobSource,
  JobStatus,
  JobType,
  type FirmwareJob,
} from "../../src/api/types.js";
import { findTemplatesByAnchor } from "../_lit-template-walker.js";
import type { ESPHomeCommandDialog } from "../../src/components/command-dialog.js";

const localize = (key: string, values?: Record<string, string | number>) => {
  // Mirror the runtime resolver enough that the renderer sees real template
  // strings (with the placeholder tokens it splits on). Tests stay locked to
  // the same en.json source the production code loads.
  const parts = key.split(".");
  let cur: unknown = enMessages as unknown;
  for (const p of parts) {
    if (cur && typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      cur = undefined;
      break;
    }
  }
  const text = typeof cur === "string" ? cur : key;
  if (!values) return text;
  return text.replace(
    /\{(\w+)\}/g,
    (_, k) => String(values[k] ?? `{${k}}`),
  );
};

function fakeJob(overrides: Partial<FirmwareJob> = {}): FirmwareJob {
  return {
    job_id: "job-1",
    configuration: "kitchen.yaml",
    job_type: JobType.INSTALL,
    status: JobStatus.FAILED,
    created_at: "2026-01-01T00:00:00Z",
    started_at: null,
    completed_at: null,
    exit_code: null,
    output: [],
    error: "",
    port: "OTA",
    new_name: "",
    progress: null,
    source: JobSource.LOCAL,
    source_pin_sha256: "",
    source_label: "",
    source_esphome_version: "",
    remote_peer: "",
    remote_peer_label: "",
    device_name: "",
    device_friendly_name: "",
    ...overrides,
  };
}

interface Host {
  _state: string;
  _userStopped: boolean;
  _commandType: string;
  _failedDuringValidate: boolean;
  _jobId: string;
  _jobs: Map<string, FirmwareJob>;
  _primedSource:
    | {
        source: JobSource;
        source_label: string;
        source_esphome_version: string;
      }
    | null;
  _tryCleanBuild: () => void;
  _tryResetBuildEnv: () => void;
  _tryOpenInEditor: () => void;
  _localize: typeof localize;
}

function baseHost(overrides: Partial<Host> = {}): Host {
  return {
    _state: "error",
    _userStopped: false,
    _commandType: "install",
    _failedDuringValidate: false,
    _jobId: "job-1",
    _jobs: new Map(),
    _primedSource: null,
    _tryCleanBuild: () => {},
    _tryResetBuildEnv: () => {},
    _tryOpenInEditor: () => {},
    _localize: localize,
    ...overrides,
  };
}

describe("renderResetSuggestion — local build", () => {
  it("emits both clean and reset links when the live job is LOCAL", () => {
    const host = baseHost({
      _jobs: new Map([
        ["job-1", fakeJob({ source: JobSource.LOCAL, source_label: "" })],
      ]),
    });
    const result = renderResetSuggestion(host as unknown as ESPHomeCommandDialog);
    const matches = findTemplatesByAnchor(result, 'class="reset-suggestion"');
    expect(matches.length).toBe(1);
    const values = matches[0].values;
    // Both click handlers wired up — the second button is the reset link
    // the local variant carries that the remote variant must drop.
    expect(values).toContain(host._tryCleanBuild);
    expect(values).toContain(host._tryResetBuildEnv);
  });

  it("falls back to LOCAL when neither live nor primed source resolves", () => {
    // _jobId is set but the jobs context hasn't caught up and there's no
    // primed snapshot — the renderer must not assume REMOTE.
    const host = baseHost({ _jobs: new Map(), _primedSource: null });
    const result = renderResetSuggestion(host as unknown as ESPHomeCommandDialog);
    const matches = findTemplatesByAnchor(result, 'class="reset-suggestion"');
    expect(matches[0].values).toContain(host._tryResetBuildEnv);
  });
});

describe("renderResetSuggestion — remote build", () => {
  it("drops the reset link and inlines the receiver label from the live job", () => {
    const host = baseHost({
      _jobs: new Map([
        [
          "job-1",
          fakeJob({
            source: JobSource.REMOTE,
            source_label: "build-server-01",
          }),
        ],
      ]),
    });
    const result = renderResetSuggestion(host as unknown as ESPHomeCommandDialog);
    const matches = findTemplatesByAnchor(result, 'class="reset-suggestion"');
    expect(matches.length).toBe(1);
    const values = matches[0].values;
    // Clean still works — fan-out to receivers shipped in db#608.
    expect(values).toContain(host._tryCleanBuild);
    // Reset link is the load-bearing assertion: must not render on remote.
    expect(values).not.toContain(host._tryResetBuildEnv);
    // Receiver label inlined as plain text so the operator knows which
    // peer to go act on.
    expect(values).toContain("build-server-01");
  });

  it("uses the primed source when the live jobs context is empty", () => {
    // followJob primes _primedSource so the first frame paints before the
    // jobs context catches up — the suggestion must honor that snapshot.
    const host = baseHost({
      _jobs: new Map(),
      _primedSource: {
        source: JobSource.REMOTE,
        source_label: "primed-peer",
        source_esphome_version: "",
      },
    });
    const result = renderResetSuggestion(host as unknown as ESPHomeCommandDialog);
    const matches = findTemplatesByAnchor(result, 'class="reset-suggestion"');
    const values = matches[0].values;
    expect(values).not.toContain(host._tryResetBuildEnv);
    expect(values).toContain("primed-peer");
  });

  it("falls back to the local hint when the remote label is empty", () => {
    // A REMOTE job with no label can't be named in the plain-text
    // instruction — degrade to the local link rather than render
    // "ask the operator of  to ...".
    const host = baseHost({
      _jobs: new Map([
        [
          "job-1",
          fakeJob({ source: JobSource.REMOTE, source_label: "" }),
        ],
      ]),
    });
    const result = renderResetSuggestion(host as unknown as ESPHomeCommandDialog);
    const matches = findTemplatesByAnchor(result, 'class="reset-suggestion"');
    expect(matches[0].values).toContain(host._tryResetBuildEnv);
  });

  it("renders nothing for user-stopped builds even on REMOTE", () => {
    // _userStopped predates the source split — staying nothing keeps the
    // hint from suggesting a fix for a deliberate cancel.
    const host = baseHost({
      _userStopped: true,
      _jobs: new Map([
        [
          "job-1",
          fakeJob({
            source: JobSource.REMOTE,
            source_label: "build-server-01",
          }),
        ],
      ]),
    });
    const result = renderResetSuggestion(host as unknown as ESPHomeCommandDialog);
    expect(findTemplatesByAnchor(result, 'class="reset-suggestion"').length).toBe(0);
  });
});
