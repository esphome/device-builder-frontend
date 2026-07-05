/**
 * Targeted tests for ``renderSentStep`` — the offloader "Pair request
 * sent" step (#1047).
 *
 * Pins that the OOB identity card (Dashboard ID + emoji fingerprint +
 * hex disclosure) renders once this dashboard's ``_offloaderIdentity``
 * has loaded, and collapses to ``nothing`` while it is still null (the
 * graceful-degradation path when the identity load is in flight or
 * failed).
 *
 * Runs in vitest's default ``node`` environment, inspecting the
 * returned ``TemplateResult`` tree via the shared
 * ``test/_lit-template-walker.ts`` helpers rather than mounting a DOM.
 */
import { nothing } from "lit";
import { describe, expect, it } from "vitest";
import type { IdentityView } from "../../../src/api/types/remote-build.js";
import type { ESPHomePairBuildServerDialog } from "../../../src/components/pair-build-server-dialog.js";
import { renderSentStep } from "../../../src/components/pair-build-server-dialog/renderers.js";
import { identityLocalize } from "../../_dom.js";
import {
  extractAttributeBindings,
  findTemplatesByAnchor,
  visitTemplates,
} from "../../_lit-template-walker.js";

const IDENTITY: IdentityView = {
  dashboard_id: "7f3c1a9e-2b04-4d6a-9c17-8e5f0a2b3c4d",
  pin_sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  server_version: "0.1.0",
  esphome_version: "2025.6.0",
  listener_bound: true,
};

function makeHost(identity: IdentityView | null): ESPHomePairBuildServerDialog {
  return {
    _localize: identityLocalize,
    _hostname: "buildbox.local",
    _port: "6055",
    _offloaderIdentity: identity,
    close: () => {},
  } as unknown as ESPHomePairBuildServerDialog;
}

/** Every interpolated value across the template tree, in render order. */
function allValues(root: unknown): unknown[] {
  const out: unknown[] = [];
  visitTemplates(root, (t) => out.push(...t.values));
  return out;
}

describe("renderSentStep", () => {
  it("renders the identity card once the offloader identity has loaded", () => {
    const tree = renderSentStep(makeHost(IDENTITY));

    const grids = findTemplatesByAnchor(tree, "<esphome-pin-emoji-grid");
    expect(grids).toHaveLength(1);
    // The emoji grid binds the raw pin via ``.pin``.
    expect(extractAttributeBindings(grids[0])[".pin"]).toBe(IDENTITY.pin_sha256);
    // The Dashboard ID is interpolated into the card body.
    expect(allValues(tree)).toContain(IDENTITY.dashboard_id);
  });

  it("renders no identity card while the offloader identity is still null", () => {
    const tree = renderSentStep(makeHost(null));

    expect(findTemplatesByAnchor(tree, "<esphome-pin-emoji-grid")).toHaveLength(0);
    expect(allValues(tree)).toContain(nothing);
    expect(allValues(tree)).not.toContain(IDENTITY.dashboard_id);
  });
});
