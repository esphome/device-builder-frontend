import type { TemplateResult } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { PairingSummary } from "../../../src/api/types/remote-build.js";
import type { LocalizeFunc } from "../../../src/common/localize.js";
import { renderPairingRow } from "../../../src/components/settings-dialog/build-offload-pairing-row.js";
import { visitTemplates } from "../../_lit-template-walker.js";

const localize: LocalizeFunc = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key} ${JSON.stringify(values)}` : key) as LocalizeFunc;

function makeSummary(esphome_version: string): PairingSummary {
  return {
    receiver_hostname: "mac.local",
    receiver_port: 6055,
    pin_sha256: "a".repeat(64),
    label: "macbook",
    paired_at: 1,
    status: "approved",
    connected: true,
    connecting: false,
    last_connect_error: "",
    esphome_version,
    enabled: true,
    auto_provision_supported: false,
    friendly_name: "",
    ha_addon: false,
    reset_build_env_supported: false,
  };
}

function ctx() {
  return {
    localize,
    // Equal to the peer version so renderPeerVersion emits the plain
    // line, not the mismatch note.
    appVersion: "2026.6.0",
    latestJob: undefined,
    onToggleEnabled: vi.fn(),
    onBuildRemote: vi.fn(),
    onViewBuild: vi.fn(),
    onEditEndpoint: vi.fn(),
    onResetBuildEnv: vi.fn(),
    onUnpair: vi.fn(),
  };
}

/** Flatten the static strings + string values across the template tree. */
function renderedText(root: TemplateResult): string {
  const parts: string[] = [];
  visitTemplates(root, (t) => {
    parts.push(...t.strings);
    for (const v of t.values) if (typeof v === "string") parts.push(v);
  });
  return parts.join(" ");
}

describe("renderPairingRow version line", () => {
  it("renders the ESPHome version when the peer has reported one", () => {
    const text = renderedText(renderPairingRow(makeSummary("2026.6.0"), ctx()));
    expect(text).toContain("settings.remote_build_peer_version_line");
    expect(text).toContain("2026.6.0");
  });

  it("omits the version line before the first handshake (empty version)", () => {
    const text = renderedText(renderPairingRow(makeSummary(""), ctx()));
    expect(text).not.toContain("settings.remote_build_peer_version_line");
  });

  it("shows the auto-provision line instead of a warning when supported", () => {
    const pairing = {
      ...makeSummary("2026.5.0"),
      auto_provision_supported: true,
      friendly_name: "",
      ha_addon: false,
      reset_build_env_supported: false,
    };
    const text = renderedText(renderPairingRow(pairing, ctx()));
    expect(text).toContain("settings.build_offload_pairing_version_auto_provision");
    expect(text).not.toContain("settings.build_offload_pairing_version_mismatch_release");
  });

  it("omits the version line on a mismatch (the mismatch note already states it)", () => {
    // appVersion 2026.6.0 vs peer 2026.5.0 -> release mismatch.
    const text = renderedText(renderPairingRow(makeSummary("2026.5.0"), ctx()));
    expect(text).not.toContain("settings.remote_build_peer_version_line");
    expect(text).toContain("settings.build_offload_pairing_version_mismatch_release");
  });

  it("omits the version line on a non-approved row even with a retained version", () => {
    const pending = { ...makeSummary("2026.6.0"), status: "pending" as const };
    const text = renderedText(renderPairingRow(pending, ctx()));
    expect(text).not.toContain("settings.remote_build_peer_version_line");
  });
});

describe("renderPairingRow reset-build-env button", () => {
  function renderWith(overrides: Partial<PairingSummary>) {
    return renderedText(
      renderPairingRow({ ...makeSummary("2026.6.0"), ...overrides }, ctx())
    );
  }

  it("shows the button on an approved, connected, capable pairing", () => {
    const text = renderWith({ reset_build_env_supported: true });
    expect(text).toContain("settings.reset_peer_env_aria");
  });

  it("hides the button without the capability", () => {
    expect(renderWith({})).not.toContain("settings.reset_peer_env_aria");
  });

  it("hides the button while disconnected", () => {
    const text = renderWith({ reset_build_env_supported: true, connected: false });
    expect(text).not.toContain("settings.reset_peer_env_aria");
  });

  it("hides the button on a pending row", () => {
    const text = renderWith({
      reset_build_env_supported: true,
      status: "pending" as const,
    });
    expect(text).not.toContain("settings.reset_peer_env_aria");
  });
});

describe("renderPairingRow display name", () => {
  it("shows the friendly name when the label is the auto-derived hostname stem", () => {
    const pairing = {
      ...makeSummary("2026.6.0"),
      label: "mac",
      friendly_name: "Nicks-Mac-Studio",
    };
    const text = renderedText(renderPairingRow(pairing, ctx()));
    expect(text).toContain("Nicks-Mac-Studio");
    // The hostname:port sub-line still shows the real endpoint.
    expect(text).toContain("mac.local");
  });

  it("keeps a custom label over the friendly name", () => {
    const pairing = {
      ...makeSummary("2026.6.0"),
      label: "Office Server",
      friendly_name: "Nicks-Mac-Studio",
    };
    const text = renderedText(renderPairingRow(pairing, ctx()));
    expect(text).toContain("Office Server");
    expect(text).not.toContain("Nicks-Mac-Studio");
  });
});
