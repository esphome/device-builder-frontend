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
 * Runs in vitest's default ``node`` environment, so we inspect the
 * returned ``TemplateResult`` tree rather than rendering to a DOM
 * (mirrors ``device/render-nested-list-field.test.ts``).
 */
import { nothing } from "lit";
import { describe, expect, it } from "vitest";
import type { IdentityView } from "../../../src/api/types.js";
import type { ESPHomePairBuildServerDialog } from "../../../src/components/pair-build-server-dialog.js";
import { renderSentStep } from "../../../src/components/pair-build-server-dialog/renderers.js";

const IDENTITY: IdentityView = {
  dashboard_id: "7f3c1a9e-2b04-4d6a-9c17-8e5f0a2b3c4d",
  pin_sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  server_version: "0.1.0",
  esphome_version: "2025.6.0",
  listener_bound: true,
};

function makeHost(identity: IdentityView | null): ESPHomePairBuildServerDialog {
  return {
    _localize: (key: string) => key,
    _hostname: "buildbox.local",
    _port: "6055",
    _offloaderIdentity: identity,
    close: () => {},
  } as unknown as ESPHomePairBuildServerDialog;
}

interface TemplateResultLike {
  strings: ReadonlyArray<string>;
  values: ReadonlyArray<unknown>;
}

function isTemplateResult(v: unknown): v is TemplateResultLike {
  return !!v && typeof v === "object" && "strings" in v && "values" in v;
}

// Flatten a (possibly nested) TemplateResult tree into its static markup
// fragments and its interpolated values so we can assert against both.
function flatten(node: unknown, markup: string[], values: unknown[]): void {
  if (isTemplateResult(node)) {
    markup.push(...node.strings);
    node.values.forEach((v) => flatten(v, markup, values));
  } else if (Array.isArray(node)) {
    node.forEach((v) => flatten(v, markup, values));
  } else {
    values.push(node);
  }
}

function flattenSentStep(identity: IdentityView | null) {
  const markup: string[] = [];
  const values: unknown[] = [];
  flatten(renderSentStep(makeHost(identity)), markup, values);
  return { markup: markup.join(""), values };
}

describe("renderSentStep", () => {
  it("renders the identity card once the offloader identity has loaded", () => {
    const { markup, values } = flattenSentStep(IDENTITY);

    expect(markup).toContain("esphome-pin-emoji-grid");
    expect(markup).toContain("pin-hex");
    // Dashboard ID and the raw pin are interpolated into the card; the
    // emoji grid binds the raw pin via ``.pin``.
    expect(values).toContain(IDENTITY.dashboard_id);
    expect(values).toContain(IDENTITY.pin_sha256);
  });

  it("renders no identity card while the identity is still null", () => {
    const { markup, values } = flattenSentStep(null);

    expect(values).toContain(nothing);
    expect(markup).not.toContain("esphome-pin-emoji-grid");
    expect(values).not.toContain(IDENTITY.dashboard_id);
  });
});
