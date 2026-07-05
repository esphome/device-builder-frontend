import { html, nothing } from "lit";
import { describe, expect, it } from "vitest";

import { renderAsyncState } from "../../src/util/render-async-state.js";

/**
 * Lit's TemplateResult exposes ``strings`` (static segments) and ``values``
 * (interpolated parts); inspecting those pins the markup shape without a DOM
 * (vitest runs this in the ``node`` environment).
 */
interface TemplateResult {
  strings: readonly string[];
  values: readonly unknown[];
}

function asTemplate(value: unknown): TemplateResult {
  return value as TemplateResult;
}

const content = () => html`<div class="content"></div>`;

describe("renderAsyncState", () => {
  it("renders a status-role message while loading", () => {
    const t = asTemplate(
      renderAsyncState({ loading: true, loadingMessage: "checking", error: "", content })
    );
    expect(t.strings.join("")).toMatch(/^<div class="message" role="status">.*<\/div>$/);
    expect(t.values).toEqual(["checking"]);
  });

  it("prefers the loading branch when both loading and error are set", () => {
    const t = asTemplate(
      renderAsyncState({
        loading: true,
        loadingMessage: "checking",
        error: "boom",
        content,
      })
    );
    expect(t.strings.join("")).toContain('role="status"');
    expect(t.values).toEqual(["checking"]);
  });

  it("renders an alert-role message on error", () => {
    const t = asTemplate(
      renderAsyncState({ loading: false, loadingMessage: "", error: "boom", content })
    );
    expect(t.strings.join("")).toContain('<div class="message error" role="alert">');
    expect(t.values[0]).toBe("boom");
  });

  it("appends errorActions after the error message when provided", () => {
    const actions = html`<div class="actions"></div>`;
    const t = asTemplate(
      renderAsyncState({
        loading: false,
        loadingMessage: "",
        error: "boom",
        errorActions: () => actions,
        content,
      })
    );
    expect(t.values[1]).toBe(actions);
  });

  it("omits errorActions (nothing) when not provided", () => {
    const t = asTemplate(
      renderAsyncState({ loading: false, loadingMessage: "", error: "boom", content })
    );
    expect(t.values[1]).toBe(nothing);
  });

  it("falls through to content() when neither loading nor error", () => {
    const marker = html`<div class="content"></div>`;
    const result = renderAsyncState({
      loading: false,
      loadingMessage: "",
      error: "",
      content: () => marker,
    });
    expect(result).toBe(marker);
  });
});
