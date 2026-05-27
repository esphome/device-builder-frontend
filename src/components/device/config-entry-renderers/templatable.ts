/**
 * Templatable-field wrapper.
 *
 * Many ESPHome config fields accept either a literal value or a
 * ``!lambda`` block returning the same type. ``ConfigEntry.templatable``
 * flags those fields; this wrapper renders a small literal/lambda
 * toggle above the inner control so the user can pick either form,
 * with the choice driving which renderer paints the body.
 *
 * Value shape discriminates the current mode:
 *
 * - plain primitive (or absent) → literal mode, the entry's normal
 *   renderer paints in place.
 * - ``LambdaValue`` (``{_lambda: "<body>"}``) → lambda mode, the
 *   dedicated CodeMirror C++ renderer paints in place.
 *
 * Toggling stashes the prior other-side value in a module-level
 * ``WeakMap`` keyed by the host element + dotted path so an
 * accidental toggle doesn't destroy the user's work — the next flip
 * back recovers it.
 */
import { html } from "lit";
import type { ConfigEntry } from "../../../api/types.js";
import { isLambdaValue } from "../../../api/types.js";
import type { RenderCtx } from "../config-entry-renderers-shared.js";
import { renderLambdaField } from "./lambda.js";

interface StashEntry {
  /** Last literal value the user typed before flipping to lambda. */
  literal?: unknown;
  /** Last lambda body the user typed before flipping to literal. */
  lambda?: string;
}

/**
 * Module-level stash keyed by the form's ``stashOwner`` (the host
 * element instance) so the stash survives re-renders. We used to
 * key by ``ctx.renderEntry`` but the form rebuilds the ctx — and
 * thus a fresh ``renderEntry`` closure — on every paint, so the
 * WeakMap key changed after every ``emitChange`` and the literal/
 * lambda toggle would lose the user's stashed-other-side value
 * after a single round-trip through Lit's update cycle.
 */
const _stashes = new WeakMap<object, Map<string, StashEntry>>();

function stashFor(ctx: RenderCtx, path: string[]): StashEntry {
  let m = _stashes.get(ctx.stashOwner);
  if (!m) {
    m = new Map();
    _stashes.set(ctx.stashOwner, m);
  }
  const key = path.join(".");
  let s = m.get(key);
  if (!s) {
    s = {};
    m.set(key, s);
  }
  return s;
}

/**
 * Render the literal/lambda toggle + the active body. Dispatched from
 * ``ESPHomeConfigEntryForm._renderEntryUnsafe`` when the entry is
 * templatable and not a structural type.
 *
 * ``innerRender`` paints the literal body; it's a thunk so the
 * caller (the form's switch) decides which primitive renderer to
 * use without templatable.ts needing to know about every field type.
 */
export function renderTemplatableField(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx,
  innerRender: () => unknown
) {
  const raw = ctx.getAt(path);
  const isLambda = isLambdaValue(raw);
  const stash = stashFor(ctx, path);
  const fieldKey = path.join(".");

  const switchTo = (toLambda: boolean) => {
    if (toLambda === isLambda) return;
    if (isLambda) {
      // Currently lambda → going to literal. Capture body, restore literal.
      stash.lambda = isLambdaValue(raw) ? raw._lambda : "";
      ctx.emitChange(path, stash.literal ?? "");
    } else {
      // Currently literal → going to lambda. Capture literal, restore lambda body.
      stash.literal = raw;
      ctx.emitChange(path, { _lambda: stash.lambda ?? "" });
    }
  };

  return html`
    <div class="templatable-field" data-field-key=${fieldKey}>
      <div
        class="templatable-toggle"
        role="tablist"
        aria-label=${ctx.localize("device.automation_literal")}
      >
        <button
          type="button"
          role="tab"
          class=${!isLambda ? "active" : ""}
          aria-selected=${!isLambda}
          ?disabled=${ctx.disabled}
          @click=${() => switchTo(false)}
        >
          ${ctx.localize("device.automation_literal")}
        </button>
        <button
          type="button"
          role="tab"
          class=${isLambda ? "active" : ""}
          aria-selected=${isLambda}
          ?disabled=${ctx.disabled}
          @click=${() => switchTo(true)}
        >
          ${ctx.localize("device.automation_lambda")}
        </button>
      </div>
      ${isLambda ? renderLambdaField(entry, path, ctx) : innerRender()}
    </div>
  `;
}
