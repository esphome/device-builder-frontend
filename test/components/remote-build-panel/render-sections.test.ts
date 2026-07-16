// @vitest-environment happy-dom
//
// Pins the remote-build panel's pure section renderers: onboarding vs
// window-open swap, pinned request card, peer connected pills, queue
// empty/submitted-by, and the disabled CTA. Fake-host idiom.

import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { JobStatus } from "../../../src/api/types/firmware-jobs.js";
import type { PeerSummary } from "../../../src/api/types/remote-build.js";
import {
  renderDisabledCta,
  renderOnboarding,
} from "../../../src/components/remote-build-panel/render-onboarding.js";
import {
  renderPeersCard,
  renderRequestCard,
} from "../../../src/components/remote-build-panel/render-peers.js";
import { renderQueueCard } from "../../../src/components/remote-build-panel/render-queue.js";
import type { ESPHomeRemoteBuildPanel } from "../../../src/components/remote-build-panel.js";
import { identityLocalize, renderInto } from "../../_dom.js";
import { makeFirmwareJob } from "../../_make-firmware-job.js";

function makePeer(overrides: Partial<PeerSummary> = {}): PeerSummary {
  return {
    dashboard_id: "dash-1",
    pin_sha256: "ab".repeat(32),
    label: "office",
    paired_at: Math.floor(Date.now() / 1000) - 60,
    status: "approved",
    peer_ip: "192.168.1.42",
    connected: true,
    friendly_name: "",
    ha_addon: false,
    label_auto: false,
    ...overrides,
  };
}

function fakePanel(overrides: Record<string, unknown> = {}): ESPHomeRemoteBuildPanel {
  return {
    _localize: identityLocalize,
    _windowState: null,
    _window: { remainingSeconds: () => null },
    _identity: { identity: null, loadFailed: false },
    _openWindow: vi.fn(),
    _extendWindow: vi.fn(),
    _reviewRequest: vi.fn(),
    _openBuildServerSettings: vi.fn(),
    _now: Date.now(),
    _jobDisplayName: (job: { configuration: string }) => job.configuration,
    _openJob: vi.fn(),
    _onCancelClick: vi.fn(),
    _buckets: () => ({ sorted: [], active: [], terminal: [] }),
    ...overrides,
  } as never;
}

describe("renderOnboarding", () => {
  it("walks the three steps with an open-window CTA while closed", () => {
    const host = fakePanel();
    const el = renderInto(renderOnboarding(host));
    expect(el.textContent).toContain("remote_build_dashboard.step_open_window_title");
    expect(el.textContent).toContain("remote_build_dashboard.step_send_request_title");
    expect(el.textContent).toContain("remote_build_dashboard.step_accept_request_title");
    const button = el.querySelector<HTMLButtonElement>(".primary-action");
    expect(button?.textContent).toContain("remote_build_dashboard.open_pairing_window");
    button?.click();
    expect(host._openWindow).toHaveBeenCalled();
  });

  it("swaps the CTA for the countdown pill once the window is open", () => {
    const host = fakePanel({
      _windowState: { open: true, expires_in_seconds: 120 },
      _window: { remainingSeconds: () => 90 },
    });
    const el = renderInto(renderOnboarding(host));
    expect(el.querySelector(".pairing-window-open")).not.toBeNull();
    expect(el.querySelector(".pairing-window-extend")).not.toBeNull();
    expect(el.textContent).not.toContain("remote_build_dashboard.open_pairing_window");
  });

  it("shows the mDNS-advertised pairing address once identity carries it", () => {
    const identity = {
      dashboard_id: "dash-0",
      pin_sha256: "cd".repeat(32),
      server_version: "1.2.0",
      esphome_version: "2026.6.1",
      listener_bound: true,
      listener_host: "esphome-builder-abc.local",
      listener_addresses: ["192.168.1.5"],
      listener_port: 6055,
    };
    const advertised = fakePanel({ _identity: { loadFailed: false, identity } });
    const el = renderInto(renderOnboarding(advertised));
    // Hostname:port up front; the advertised IPs behind the chevron.
    expect(
      el.querySelector(".step-address details.pairing-address summary code")?.textContent
    ).toBe("esphome-builder-abc.local:6055");
    expect(el.querySelector(".pairing-address-ip code")?.textContent).toBe(
      "192.168.1.5:6055"
    );
    // No advertiser attached: browser-hostname fallback, no disclosure.
    const noAdvertiser = fakePanel({
      _identity: {
        loadFailed: false,
        identity: { ...identity, listener_host: null, listener_addresses: [] },
      },
    });
    const fallback = renderInto(renderOnboarding(noAdvertiser));
    expect(fallback.querySelector(".step-address code")?.textContent).toBe(
      `${window.location.hostname}:6055`
    );
    expect(fallback.querySelector(".step-address details")).toBeNull();
    // Unbound listener / pre-port backend: no address line.
    const withoutPort = renderInto(renderOnboarding(fakePanel()));
    expect(withoutPort.querySelector(".step-address")).toBeNull();
  });

  it("shows the identity loading row until the fingerprint lands", () => {
    const el = renderInto(renderOnboarding(fakePanel()));
    expect(el.textContent).toContain("settings.remote_build_identity_loading");
  });

  it("renders the fingerprint grid once identity loads, versions left to the footer", () => {
    const host = fakePanel({
      _identity: {
        loadFailed: false,
        identity: {
          dashboard_id: "dash-0",
          pin_sha256: "cd".repeat(32),
          server_version: "1.2.0",
          esphome_version: "2026.6.1",
          listener_bound: true,
        },
      },
    });
    const el = renderInto(renderOnboarding(host));
    expect(el.querySelector("esphome-pin-emoji-grid")).not.toBeNull();
    expect(el.textContent).not.toContain("1.2.0");
    expect(el.textContent).not.toContain("2026.6.1");
  });
});

describe("renderRequestCard", () => {
  it("announces the sender and routes Review to the accept dialog", () => {
    const host = fakePanel();
    const peer = makePeer({ status: "pending" });
    const el = renderInto(renderRequestCard(host, peer));
    expect(el.textContent).toContain("remote_build_dashboard.request_title");
    expect(el.textContent).toContain("192.168.1.42");
    el.querySelector<HTMLButtonElement>(".primary-action")?.click();
    expect(host._reviewRequest).toHaveBeenCalledWith(peer);
  });
});

describe("renderPeersCard", () => {
  it("shows connected and disconnected pills per peer", () => {
    const el = renderInto(
      renderPeersCard(fakePanel(), [
        makePeer({ label: "office", connected: true }),
        makePeer({ dashboard_id: "dash-2", label: "lab", connected: false }),
      ])
    );
    expect(el.querySelector(".peer-connection-connected")).not.toBeNull();
    expect(el.querySelector(".peer-connection-disconnected")).not.toBeNull();
    expect(el.textContent).toContain("office");
    expect(el.textContent).toContain("lab");
  });

  it("offers Manage → settings and an open-window action while closed", () => {
    const host = fakePanel();
    const el = renderInto(renderPeersCard(host, [makePeer()]));
    const actions = [...el.querySelectorAll<HTMLButtonElement>(".heading-action")];
    expect(
      actions.some((b) =>
        b.textContent?.includes("remote_build_dashboard.open_pairing_window")
      )
    ).toBe(true);
    const manage = actions.find((b) =>
      b.textContent?.includes("remote_build_dashboard.peers_manage")
    );
    manage?.click();
    expect(host._openBuildServerSettings).toHaveBeenCalled();
  });
});

describe("renderQueueCard", () => {
  it("renders the shared empty state with no jobs", () => {
    const el = renderInto(renderQueueCard(fakePanel()));
    expect(el.textContent).toContain("firmware_jobs.empty_title");
  });

  it("renders rows with the submitted-by source line for remote jobs", () => {
    const job = makeFirmwareJob({
      status: JobStatus.RUNNING,
      started_at: "2026-01-01T00:00:30Z",
      remote_peer: "dash-1",
      remote_peer_label: "office",
    });
    const host = fakePanel({
      _buckets: () => ({ sorted: [job], active: [job], terminal: [] }),
    });
    const el = renderInto(renderQueueCard(host));
    expect(el.textContent).toContain("firmware_jobs.submitted_by");
    expect(el.textContent).toContain("remote_build_dashboard.queue_active_count");
  });
});

describe("renderDisabledCta", () => {
  it("points at the build-server settings section", () => {
    const host = fakePanel();
    const el = renderInto(renderDisabledCta(host));
    expect(el.textContent).toContain("remote_build_dashboard.disabled_title");
    el.querySelector<HTMLButtonElement>(".primary-action")?.click();
    expect(host._openBuildServerSettings).toHaveBeenCalled();
  });
});
