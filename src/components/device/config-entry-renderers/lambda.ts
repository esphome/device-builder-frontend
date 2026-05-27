/**
 * Renderer for ``ConfigEntryType.LAMBDA`` fields.
 *
 * Mounts ``<esphome-lambda-editor>`` (a tiny CodeMirror wrapper using
 * ``@codemirror/lang-cpp``) inside the standard field shell. The
 * editor handles the C++ body only — the ``!lambda |- `` tag prefix
 * lives at serialisation, never in the user-visible text.
 */
import { html } from "lit";
import type { ConfigEntry } from "../../../api/types.js";
import { isLambdaValue } from "../../../api/types.js";
import {
  effectiveDisabled,
  renderFieldShell,
  type RenderCtx,
} from "../config-entry-renderers-shared.js";
import { YamlRawValue } from "../../../util/yaml-serialize.js";
import "./lambda-editor.js";

/**
 * Extract the C++ body from the various shapes a lambda value can
 * arrive in:
 *
 * - ``LambdaValue`` sentinel (``{_lambda: "<body>"}``) — the canonical
 *   shape used by the automation editor.
 * - ``YamlRawValue`` — when the editor inherits an existing
 *   ``!lambda |-`` block from YAML, the raw body is preserved
 *   byte-for-byte.
 * - plain string — fall back for hand-edited values.
 */
function bodyOf(raw: unknown): string {
  if (isLambdaValue(raw)) return raw._lambda;
  if (raw instanceof YamlRawValue) return raw.body;
  if (raw == null) return "";
  return String(raw);
}

export function renderLambdaField(entry: ConfigEntry, path: string[], ctx: RenderCtx) {
  const raw = ctx.getAt(path);
  const value = bodyOf(raw);
  const invalid = ctx.errorAt(path) !== null;
  const disabled = effectiveDisabled(entry, ctx);
  return renderFieldShell(
    entry,
    path,
    ctx,
    html`<esphome-lambda-editor
      .value=${value}
      .invalid=${invalid}
      ?disabled=${disabled}
      placeholder=${String(entry.default_value ?? "")}
      @lambda-change=${(e: CustomEvent<{ value: string }>) =>
        ctx.emitChange(path, { _lambda: e.detail.value })}
    ></esphome-lambda-editor>`
  );
}
