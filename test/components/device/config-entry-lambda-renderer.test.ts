/**
 * Tests for ``renderLambdaField`` — the CodeMirror-backed renderer
 * for ``ConfigEntryType.LAMBDA`` fields.
 *
 * We can't mount the CodeMirror editor in vitest's node environment,
 * but we can pin two contractual surfaces:
 *
 * 1. The body extracted onto the editor's ``.value`` property must
 *    match what the value-shape claims — ``LambdaValue`` sentinel,
 *    ``YamlRawValue`` block, or a plain string fall through to the
 *    body text without prefix decoration.
 * 2. The ``lambda-change`` listener must wrap the new body into a
 *    ``LambdaValue`` sentinel when emitting via ``ctx.emitChange``
 *    — that's the round-trip invariant for the writer.
 */
import type { TemplateResult } from "lit";
import { describe, expect, it, vi } from "vitest";
import { ConfigEntryType } from "../../../src/api/types.js";
import { renderLambdaField } from "../../../src/components/device/config-entry-renderers/lambda.js";
import { YamlRawValue } from "../../../src/util/yaml-serialize.js";
import { findTemplatesByAnchor, isTemplateResult } from "../../_lit-template-walker.js";
import { makeEntry, makeRenderCtx } from "./_renderer-fixtures.js";

function getEditorBindings(template: unknown): Record<string, unknown> {
  const editor = findTemplatesByAnchor(template, "<esphome-lambda-editor")[0];
  if (!isTemplateResult(editor)) {
    throw new Error("<esphome-lambda-editor> not found in template");
  }
  const t = editor as TemplateResult;
  const out: Record<string, unknown> = {};
  for (let i = 0; i < t.values.length; i++) {
    const m = t.strings[i].match(/(\.|@|\?)?([\w-]+)\s*=\s*"?\s*$/);
    if (!m) continue;
    out[(m[1] ?? "") + m[2]] = t.values[i];
  }
  return out;
}

describe("renderLambdaField body extraction", () => {
  it("pulls the C++ body out of a LambdaValue sentinel", () => {
    const ctx = makeRenderCtx({ field: { _lambda: "return 42;" } });
    const entry = makeEntry(ConfigEntryType.LAMBDA, { key: "field" });
    const template = renderLambdaField(entry, ["field"], ctx);
    const b = getEditorBindings(template);
    expect(b[".value"]).toBe("return 42;");
  });

  it("pulls the body out of a YamlRawValue block scalar", () => {
    const ctx = makeRenderCtx({
      field: new YamlRawValue(["  return 1;"], "!lambda |-"),
    });
    const entry = makeEntry(ConfigEntryType.LAMBDA, { key: "field" });
    const template = renderLambdaField(entry, ["field"], ctx);
    const b = getEditorBindings(template);
    // The body getter strips the common indent — ``"  return 1;"``
    // dedents to ``"return 1;"``.
    expect(b[".value"]).toBe("return 1;");
  });

  it("falls back to String(raw) for a plain string", () => {
    const ctx = makeRenderCtx({ field: "return 0;" });
    const entry = makeEntry(ConfigEntryType.LAMBDA, { key: "field" });
    const template = renderLambdaField(entry, ["field"], ctx);
    const b = getEditorBindings(template);
    expect(b[".value"]).toBe("return 0;");
  });

  it("renders an empty body when no value is set", () => {
    const ctx = makeRenderCtx({});
    const entry = makeEntry(ConfigEntryType.LAMBDA, { key: "field" });
    const template = renderLambdaField(entry, ["field"], ctx);
    const b = getEditorBindings(template);
    expect(b[".value"]).toBe("");
  });
});

describe("renderLambdaField change handler", () => {
  it("wraps the new body into a LambdaValue sentinel before emitting", () => {
    const emit = vi.fn();
    const ctx = makeRenderCtx({}, { overrides: { emitChange: emit } });
    const entry = makeEntry(ConfigEntryType.LAMBDA, { key: "field" });
    const template = renderLambdaField(entry, ["field"], ctx);
    const b = getEditorBindings(template);
    const handler = b["@lambda-change"];
    expect(typeof handler).toBe("function");
    (handler as (e: CustomEvent<{ value: string }>) => void)(
      new CustomEvent("lambda-change", { detail: { value: "return 7;" } })
    );
    expect(emit).toHaveBeenCalledTimes(1);
    const [path, value] = emit.mock.calls[0];
    expect(path).toEqual(["field"]);
    expect(value).toEqual({ _lambda: "return 7;" });
  });
});
