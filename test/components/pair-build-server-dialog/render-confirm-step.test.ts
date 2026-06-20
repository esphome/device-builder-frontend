/**
 * Targeted tests for ``renderConfirmStep`` — pins the connecting state used
 * when an mDNS-discovered host auto-previews straight into the confirm step.
 *
 * While ``_previewedPin`` is empty the step shows a ``<wa-spinner>`` +
 * "connecting" line (no fingerprint); once the pin lands it shows the emoji
 * grid + "connected" target. Walks the returned ``TemplateResult`` tree via
 * the shared ``test/_lit-template-walker.ts`` helpers (node env, no DOM).
 */
import { describe, expect, it } from "vitest";
import type { ESPHomePairBuildServerDialog } from "../../../src/components/pair-build-server-dialog.js";
import { renderConfirmStep } from "../../../src/components/pair-build-server-dialog/renderers.js";
import { findTemplatesByAnchor, visitTemplates } from "../../_lit-template-walker.js";

function makeHost(pin: string): ESPHomePairBuildServerDialog {
  return {
    _localize: (key: string) => key,
    _busy: false,
    _previewedPin: pin,
    _hostname: "buildbox.local",
    _port: "6055",
    _receiverLabel: "buildbox",
    _offloaderLabel: "ha-green",
    _error: null,
    _onConfirmBack: () => {},
    _onConfirmSubmit: () => {},
    close: () => {},
  } as unknown as ESPHomePairBuildServerDialog;
}

/** Every interpolated value across the template tree, in render order. */
function allValues(root: unknown): unknown[] {
  const out: unknown[] = [];
  visitTemplates(root, (t) => out.push(...t.values));
  return out;
}

describe("renderConfirmStep", () => {
  it("shows a connecting spinner (no fingerprint) while the pin is empty", () => {
    const tree = renderConfirmStep(makeHost(""));

    expect(findTemplatesByAnchor(tree, "<wa-spinner")).toHaveLength(1);
    expect(findTemplatesByAnchor(tree, "<esphome-pin-emoji-grid")).toHaveLength(0);
    expect(allValues(tree)).toContain("settings.pair_build_server_connecting");
  });

  it("shows the fingerprint and target once the pin has landed", () => {
    const tree = renderConfirmStep(makeHost("9f86d081884c7d659a2feaa0c55ad015"));

    expect(findTemplatesByAnchor(tree, "<wa-spinner")).toHaveLength(0);
    expect(findTemplatesByAnchor(tree, "<esphome-pin-emoji-grid")).toHaveLength(1);
    expect(allValues(tree)).toContain("settings.pair_build_server_target");
  });
});
