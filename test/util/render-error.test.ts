import { describe, expect, it } from "vitest";
import { nothing } from "lit";

import { renderErrorBanner, renderInlineError } from "../../src/util/render-error.js";

/**
 * Lit's TemplateResult exposes a ``strings`` array (the static
 * template literal segments) and a ``values`` array (the
 * interpolated parts). Inspecting those is enough to pin the
 * markup shape without spinning up a DOM (vitest config runs
 * in the ``node`` environment).
 */
interface TemplateResult {
  strings: readonly string[];
  values: readonly unknown[];
}

function asTemplate(value: unknown): TemplateResult {
  return value as TemplateResult;
}

describe("renderInlineError", () => {
  it("returns nothing for undefined", () => {
    expect(renderInlineError(undefined)).toBe(nothing);
  });

  it("returns nothing for empty string", () => {
    expect(renderInlineError("")).toBe(nothing);
  });

  it("renders a span.field-error wrapping the message", () => {
    const t = asTemplate(renderInlineError("name is required"));
    expect(t.strings.join("")).toMatch(/^<span class="field-error">.*<\/span>$/);
    expect(t.values).toEqual(["name is required"]);
  });

  it("does NOT add role=alert (inline-validation, not status region)", () => {
    const t = asTemplate(renderInlineError("bad"));
    expect(t.strings.join("")).not.toContain('role="alert"');
  });
});

describe("renderErrorBanner", () => {
  it("returns nothing for undefined", () => {
    expect(renderErrorBanner(undefined)).toBe(nothing);
  });

  it("returns nothing for empty string", () => {
    expect(renderErrorBanner("")).toBe(nothing);
  });

  it("renders a div.field-error[role=alert] wrapping the message", () => {
    const t = asTemplate(renderErrorBanner("connect refused"));
    expect(t.strings.join("")).toMatch(
      /^<div class="field-error" role="alert">.*<\/div>$/
    );
    expect(t.values).toEqual(["connect refused"]);
  });
});
