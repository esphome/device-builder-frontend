/**
 * Tests for ``renderTemplatableField`` — the literal/lambda toggle
 * wrapper for templatable ConfigEntry fields.
 *
 * Vitest runs in node and the lambda renderer mounts CodeMirror
 * inside a Lit element, so we don't render the wrapper to a real
 * DOM. Instead we drive the wrapper's logic directly and pin the
 * emitted ``value-change`` payload shape — toggling literal → lambda
 * must emit a ``LambdaValue`` sentinel, and the reverse must restore
 * the literal stash.
 */
import type { TemplateResult } from "lit";
import { describe, expect, it, vi } from "vitest";
import { ConfigEntryType } from "../../../src/api/types.js";
import type { LambdaValue } from "../../../src/api/types.js";
import { renderTemplatableField } from "../../../src/components/device/config-entry-renderers/templatable.js";
import { isTemplateResult } from "../../_lit-template-walker.js";
import { makeEntry, makeRenderCtx } from "./_renderer-fixtures.js";

/**
 * Extract every ``@click`` handler from a template in declaration
 * order. The wrapper emits two buttons in literal-then-lambda order
 * inside a single template, so the two click handlers in ``values``
 * line up with that order too.
 */
function clickHandlers(template: unknown): Array<(e: Event) => void> {
  if (!isTemplateResult(template)) {
    throw new Error("Expected a Lit TemplateResult");
  }
  const t = template as TemplateResult;
  const out: Array<(e: Event) => void> = [];
  for (let i = 0; i < t.values.length; i++) {
    const prefix = t.strings[i];
    if (/@click\s*=\s*"?\s*$/.test(prefix) && typeof t.values[i] === "function") {
      out.push(t.values[i] as (e: Event) => void);
    }
  }
  return out;
}

function clickAt(template: unknown, label: "literal" | "lambda") {
  const handlers = clickHandlers(template);
  if (handlers.length < 2) {
    throw new Error(
      `Expected two click handlers (literal + lambda); got ${handlers.length}`
    );
  }
  const handler = label === "literal" ? handlers[0] : handlers[1];
  handler(new Event("click"));
}

describe("renderTemplatableField", () => {
  it("calls the inner renderer when value is a plain primitive (literal mode)", () => {
    const innerRender = vi.fn(() => "<INNER>");
    const ctx = makeRenderCtx({ field: "hello" });
    const entry = makeEntry(ConfigEntryType.STRING, {
      key: "field",
      templatable: true,
    });
    renderTemplatableField(entry, ["field"], ctx, innerRender);
    expect(innerRender).toHaveBeenCalledTimes(1);
  });

  it("does not call the inner renderer when value is a LambdaValue (lambda mode)", () => {
    const innerRender = vi.fn(() => "<INNER>");
    const ctx = makeRenderCtx({ field: { _lambda: "return 1;" } });
    const entry = makeEntry(ConfigEntryType.STRING, {
      key: "field",
      templatable: true,
    });
    renderTemplatableField(entry, ["field"], ctx, innerRender);
    expect(innerRender).not.toHaveBeenCalled();
  });

  it("toggling literal → lambda emits a LambdaValue sentinel", () => {
    const emit = vi.fn();
    const ctx = makeRenderCtx({ field: "hello" }, { overrides: { emitChange: emit } });
    const entry = makeEntry(ConfigEntryType.STRING, {
      key: "field",
      templatable: true,
    });
    const template = renderTemplatableField(entry, ["field"], ctx, () => "<INNER>");
    clickAt(template, "lambda");
    expect(emit).toHaveBeenCalledTimes(1);
    const [path, value] = emit.mock.calls[0];
    expect(path).toEqual(["field"]);
    expect(value).toEqual({ _lambda: "" } satisfies LambdaValue);
  });

  it("toggling lambda → literal emits a non-lambda primitive", () => {
    const emit = vi.fn();
    const ctx = makeRenderCtx(
      { field: { _lambda: "return 1;" } },
      { overrides: { emitChange: emit } }
    );
    const entry = makeEntry(ConfigEntryType.STRING, {
      key: "field",
      templatable: true,
    });
    const template = renderTemplatableField(entry, ["field"], ctx, () => "<INNER>");
    clickAt(template, "literal");
    expect(emit).toHaveBeenCalledTimes(1);
    const [, value] = emit.mock.calls[0];
    expect(value).not.toEqual(expect.objectContaining({ _lambda: expect.anything() }));
  });

  it("re-clicking the active mode is a no-op (no double-emit)", () => {
    const emit = vi.fn();
    const ctx = makeRenderCtx({ field: "hello" }, { overrides: { emitChange: emit } });
    const entry = makeEntry(ConfigEntryType.STRING, {
      key: "field",
      templatable: true,
    });
    const template = renderTemplatableField(entry, ["field"], ctx, () => "<INNER>");
    clickAt(template, "literal");
    expect(emit).not.toHaveBeenCalled();
  });
});
