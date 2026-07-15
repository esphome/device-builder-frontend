// @vitest-environment happy-dom
//
// Pins the "Building on <receiver> (<version>)" sub-line: the version
// shown is the one that actually builds — the receiver's installed
// esphome normally, this dashboard's own when the receiver
// auto-provisions a mismatch.

import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { JobSource } from "../../src/api/types/firmware-jobs.js";
import type { PairingSummary } from "../../src/api/types/remote-build.js";
import type { ESPHomeCommandDialog } from "../../src/components/command-dialog.js";
import { renderRemoteBuilderSubLine } from "../../src/components/command-dialog/renderers.js";
import { renderInto } from "../_dom.js";

const PIN = "a".repeat(64);

function makePairing(auto: boolean): PairingSummary {
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
    auto_provision_supported: auto,
  };
}

function makeHost(opts: { auto: boolean; localVersion?: string }): ESPHomeCommandDialog {
  return {
    _localize: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
    _jobId: "j1",
    _jobs: new Map(),
    _primedSource: {
      source: JobSource.REMOTE,
      source_label: "builder",
      source_esphome_version: "2026.6.5",
      source_pin_sha256: PIN,
    },
    _pairings: new Map([[PIN, makePairing(opts.auto)]]),
    _appVersion: opts.localVersion ?? "2026.7.0b2",
    _commandType: "compile",
    _switchingToLocal: false,
  } as unknown as ESPHomeCommandDialog;
}

describe("renderRemoteBuilderSubLine version", () => {
  it("shows the local version when the receiver auto-provisions the mismatch", () => {
    const el = renderInto(renderRemoteBuilderSubLine(makeHost({ auto: true })));
    expect(el.textContent).toContain("builder (2026.7.0b2)");
  });

  it("shows the receiver's version when it can't auto-provision", () => {
    const el = renderInto(renderRemoteBuilderSubLine(makeHost({ auto: false })));
    expect(el.textContent).toContain("builder (2026.6.5)");
  });

  it("shows the receiver's version for a dev local build (unprovisionable)", () => {
    const el = renderInto(
      renderRemoteBuilderSubLine(makeHost({ auto: true, localVersion: "2026.8.0-dev" }))
    );
    expect(el.textContent).toContain("builder (2026.6.5)");
  });
});
