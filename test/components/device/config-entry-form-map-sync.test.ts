/**
 * Regression guard for the dotted-map-key bug (#1005) at the form's
 * value-sync seam. ``_syncSelectValues`` recovers a field's path from
 * its ``data-field-key`` with ``parseFieldKey``; this pins the other
 * half — the MAP renderer emits a ``data-field-key`` for a row keyed
 * ``i2c.idf`` that ``parseFieldKey`` decodes back to the dotted path,
 * so the value lookup hits instead of over-segmenting into
 * ``["logs","i2c","idf"]`` and blanking the select.
 *
 * Node env (no DOM): wa-select can't mount under happy-dom (its
 * form-associated base reads ``ElementInternals.validity``), so we
 * walk the ``TemplateResult`` the renderers produce rather than a
 * shadow root.
 */
import { describe, expect, it } from "vitest";
import { ConfigEntryType } from "../../../src/api/types.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";
import {
  renderMapField,
  renderSelectField,
} from "../../../src/components/device/config-entry-renderers.js";
import {
  parseFieldKey,
  type RenderCtx,
} from "../../../src/components/device/config-entry-renderers-shared.js";
import { findElementBindings, makeRenderCtx } from "./_renderer-fixtures.js";

const LOG_LEVELS = ["NONE", "ERROR", "WARN", "INFO", "DEBUG", "VERBOSE"].map((v) => ({
  value: v,
  label: v,
}));

const logsEntry = () =>
  makeConfigEntry({
    key: "logs",
    type: ConfigEntryType.MAP,
    config_entries: [
      makeConfigEntry({
        key: "value",
        type: ConfigEntryType.STRING,
        options: LOG_LEVELS,
      }),
    ],
  });

/** Render the logger ``logs`` map for *values* with the value template
 *  routed through the real select renderer, and return every
 *  ``data-field-key`` decoded back to a path. */
function renderedFieldPaths(values: Record<string, unknown>): string[][] {
  let ctx: RenderCtx;
  ctx = makeRenderCtx(values, {
    overrides: { renderEntry: (entry, path) => renderSelectField(entry, path, ctx) },
  });
  const result = renderMapField(logsEntry(), ["logs"], ctx);
  return findElementBindings(result, "div")
    .map((b) => b["data-field-key"])
    .filter((k): k is string => typeof k === "string")
    .map(parseFieldKey);
}

describe("logger.logs MAP renders a recoverable field path for dotted keys", () => {
  it("emits a data-field-key that decodes back to the dotted path", () => {
    expect(renderedFieldPaths({ logs: { "i2c.idf": "DEBUG" } })).toContainEqual([
      "logs",
      "i2c.idf",
    ]);
  });

  it("does not over-segment the dotted key into separate path levels", () => {
    expect(renderedFieldPaths({ logs: { "i2c.idf": "DEBUG" } })).not.toContainEqual([
      "logs",
      "i2c",
      "idf",
    ]);
  });

  it("still encodes a plain (dotless) key as its own path", () => {
    expect(renderedFieldPaths({ logs: { wifi: "WARN" } })).toContainEqual([
      "logs",
      "wifi",
    ]);
  });
});
