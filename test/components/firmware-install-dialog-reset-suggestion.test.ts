/**
 * Tests for the Web-Serial firmware install dialog's failure-hint branching.
 *
 * Same shape as the command-dialog test: REMOTE-sourced compile failures
 * must replace the local "reset build environment" link with a plain-text
 * "ask the operator of <receiver>" instruction. The renderer is wrapped
 * inside ``renderStatus`` (the only exported surface in renderers.ts), so
 * tests drive it through that.
 */
import { describe, it } from "vitest";
import { JobSource } from "../../src/api/types.js";
import type { ESPHomeFirmwareInstallDialog } from "../../src/components/firmware-install-dialog.js";
import { renderStatus } from "../../src/components/firmware-install-dialog/renderers.js";
import {
  expectFallbackToLocal,
  expectLocalSuggestion,
  expectNoSuggestion,
  expectRemoteSuggestion,
  localize,
  type LocalizeFn,
} from "./_reset-suggestion-helpers.js";

interface Host {
  _step: string;
  _statusMessage: string;
  _errorMessage: string;
  _failedDuringCompile: boolean;
  _failedDuringValidate: boolean;
  _jobSource: JobSource;
  _jobSourceLabel: string;
  _tryCleanBuild: () => void;
  _tryResetBuildEnv: () => void;
  _tryOpenInEditor: () => void;
  _localize: LocalizeFn;
}

function baseHost(overrides: Partial<Host> = {}): Host {
  return {
    _step: "error",
    _statusMessage: "Install failed.",
    _errorMessage: "Boom",
    _failedDuringCompile: true,
    _failedDuringValidate: false,
    _jobSource: JobSource.LOCAL,
    _jobSourceLabel: "",
    _tryCleanBuild: () => {},
    _tryResetBuildEnv: () => {},
    _tryOpenInEditor: () => {},
    _localize: localize,
    ...overrides,
  };
}

const render = (host: Host) =>
  renderStatus(host as unknown as ESPHomeFirmwareInstallDialog);

describe("firmware-install-dialog renderStatus failure suggestion", () => {
  it("emits both clean and reset links on a LOCAL build failure", () => {
    const host = baseHost();
    expectLocalSuggestion(render(host), host);
  });

  it("drops the reset link and names the receiver on a REMOTE failure", () => {
    const host = baseHost({
      _jobSource: JobSource.REMOTE,
      _jobSourceLabel: "build-server-01",
    });
    expectRemoteSuggestion(render(host), host, "build-server-01");
  });

  it("falls back to the local hint when the REMOTE label is empty", () => {
    // A REMOTE job with no label can't name the receiver — degrade to the
    // local link rather than render a nameless instruction.
    const host = baseHost({
      _jobSource: JobSource.REMOTE,
      _jobSourceLabel: "",
    });
    expectFallbackToLocal(render(host), host);
  });

  it("skips the build hint entirely on a peer-link session loss", () => {
    // This is a transport error, not a broken toolchain — neither variant
    // of the build-failure hint applies. (Pre-existing behavior, kept.)
    const host = baseHost({
      _errorMessage: "remote build: peer-link session lost (transport_error: …)",
      _jobSource: JobSource.REMOTE,
      _jobSourceLabel: "build-server-01",
    });
    expectNoSuggestion(render(host));
  });
});
