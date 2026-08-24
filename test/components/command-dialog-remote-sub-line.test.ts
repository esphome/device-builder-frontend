// @vitest-environment happy-dom
//
// Pins the "Building on <receiver> (<version>)" sub-line: the version
// renders verbatim from source_esphome_version, which the backend stamps
// only when the receiver builds with its own esphome instead of ours.

import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { renderInto } from "../_dom.js";
import { JobSource } from "../../src/api/types/firmware-jobs.js";
import type { PairingSummary } from "../../src/api/types/remote-build.js";
import type { ESPHomeCommandDialog } from "../../src/components/command-dialog.js";
import { renderRemoteBuilderSubLine } from "../../src/components/command-dialog/renderers.js";

const PIN = "a".repeat(64);

function makePairing(): PairingSummary {
  return {
    receiver_hostname: "esphome-builder-x.local",
    receiver_port: 6055,
    pin_sha256: PIN,
    label: "builder",
    paired_at: 1,
    status: "approved",
    connected: true,
    connecting: false,
    last_connect_error: "",
    esphome_version: "2026.6.5",
    enabled: true,
    auto_provision_supported: false,
    friendly_name: "",
    ha_addon: false,
    reset_build_env_supported: false,
    receiver_label_auto: false,
  };
}

function makeHost(
  opts: { sourceVersion?: string; commandType?: string } = {}
): ESPHomeCommandDialog {
  return {
    _localize: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
    _jobId: "j1",
    _jobs: new Map(),
    _primedSource: {
      source: JobSource.REMOTE,
      source_label: "builder",
      source_esphome_version: opts.sourceVersion ?? "2026.6.5",
      source_pin_sha256: PIN,
    },
    _pairings: new Map([[PIN, makePairing()]]),
    _commandType: opts.commandType ?? "compile",
    _switchingToLocal: false,
  } as unknown as ESPHomeCommandDialog;
}

describe("renderRemoteBuilderSubLine version", () => {
  it("renders the stamped version", () => {
    const el = renderInto(renderRemoteBuilderSubLine(makeHost()));
    expect(el.textContent).toContain("builder (2026.6.5)");
  });

  it("renders just the receiver name when no version is stamped", () => {
    const el = renderInto(renderRemoteBuilderSubLine(makeHost({ sourceVersion: "" })));
    expect(el.textContent).toContain("builder");
    expect(el.textContent).not.toContain("(");
  });

  it("offers Build locally for a reopened remote deferred install", () => {
    const el = renderInto(
      renderRemoteBuilderSubLine(makeHost({ commandType: "offline_compile" }))
    );
    expect(el.querySelector(".force-local-link")).not.toBeNull();
  });

  it("keeps the override hidden for a plain compile", () => {
    const el = renderInto(renderRemoteBuilderSubLine(makeHost()));
    expect(el.querySelector(".force-local-link")).toBeNull();
  });

  it("prefers the pairing's friendly name over the auto-derived snapshot label", () => {
    const host = makeHost();
    const pairing = {
      ...makePairing(),
      label: "esphome-builder-x",
      friendly_name: "Nicks-Mac-Studio",
      receiver_label_auto: true,
    };
    (host as unknown as { _pairings: Map<string, PairingSummary> })._pairings = new Map([
      [PIN, pairing],
    ]);
    const el = renderInto(renderRemoteBuilderSubLine(host));
    expect(el.textContent).toContain("Nicks-Mac-Studio (2026.6.5)");
  });
});
