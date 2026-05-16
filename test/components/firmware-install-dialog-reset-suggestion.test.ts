/**
 * Tests for the Web-Serial firmware install dialog's failure-hint branching.
 *
 * Same shape as the command-dialog test: REMOTE-sourced compile failures
 * must replace the local "reset build environment" link with a plain-text
 * "ask the operator of <receiver>" instruction. The renderer is wrapped
 * inside ``renderStatus`` (the only exported surface in renderers.ts), so
 * tests drive it through that.
 */
import { describe, expect, it } from "vitest";
import enMessages from "../../src/translations/en.json";
import { renderStatus } from "../../src/components/firmware-install-dialog/renderers.js";
import { JobSource } from "../../src/api/types.js";
import { findTemplatesByAnchor } from "../_lit-template-walker.js";
import type { ESPHomeFirmwareInstallDialog } from "../../src/components/firmware-install-dialog.js";

const localize = (key: string, values?: Record<string, string | number>) => {
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
  _localize: typeof localize;
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

describe("firmware-install-dialog renderStatus failure suggestion", () => {
  it("emits both clean and reset links on a LOCAL build failure", () => {
    const host = baseHost();
    const tree = renderStatus(host as unknown as ESPHomeFirmwareInstallDialog);
    const matches = findTemplatesByAnchor(tree, 'class="reset-suggestion"');
    expect(matches.length).toBe(1);
    const values = matches[0].values;
    expect(values).toContain(host._tryCleanBuild);
    expect(values).toContain(host._tryResetBuildEnv);
  });

  it("drops the reset link and names the receiver on a REMOTE failure", () => {
    const host = baseHost({
      _jobSource: JobSource.REMOTE,
      _jobSourceLabel: "build-server-01",
    });
    const tree = renderStatus(host as unknown as ESPHomeFirmwareInstallDialog);
    const matches = findTemplatesByAnchor(tree, 'class="reset-suggestion"');
    expect(matches.length).toBe(1);
    const values = matches[0].values;
    expect(values).toContain(host._tryCleanBuild);
    // The load-bearing assertion: the reset link doesn't render because the
    // local reset-build-env command can't touch the receiver's cache.
    expect(values).not.toContain(host._tryResetBuildEnv);
    expect(values).toContain("build-server-01");
  });

  it("falls back to the local hint when the REMOTE label is empty", () => {
    // A REMOTE job with no label can't name the receiver — degrade to the
    // local link rather than render a nameless instruction.
    const host = baseHost({
      _jobSource: JobSource.REMOTE,
      _jobSourceLabel: "",
    });
    const tree = renderStatus(host as unknown as ESPHomeFirmwareInstallDialog);
    const matches = findTemplatesByAnchor(tree, 'class="reset-suggestion"');
    expect(matches[0].values).toContain(host._tryResetBuildEnv);
  });

  it("skips the build hint entirely on a peer-link session loss", () => {
    // This is a transport error, not a broken toolchain — neither variant
    // of the build-failure hint applies. (Pre-existing behavior, kept.)
    const host = baseHost({
      _errorMessage: "remote build: peer-link session lost (transport_error: …)",
      _jobSource: JobSource.REMOTE,
      _jobSourceLabel: "build-server-01",
    });
    const tree = renderStatus(host as unknown as ESPHomeFirmwareInstallDialog);
    expect(findTemplatesByAnchor(tree, 'class="reset-suggestion"').length).toBe(0);
  });
});
