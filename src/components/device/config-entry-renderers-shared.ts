/**
 * Shared types + helpers used by every ConfigEntry renderer. Kept in
 * its own module so the simple-field, pin, and id-reference renderers
 * can import from one place without circular dependencies through the
 * barrel.
 */

import { mdiKeyVariant, mdiLockOutline } from "@mdi/js";
import { html, nothing } from "lit";
import type { BoardCatalogEntry, ConfigEntry } from "../../api/types.js";
import { ConfigEntryType } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import type { PasswordInputValueChange } from "./password-input.js";
import type { ValidationError } from "../../util/config-validation.js";
import { renderMarkdown } from "../../util/markdown.js";
import { renderInlineError } from "../../util/render-error.js";
import { registerMdiIcons } from "../../util/register-icons.js";

registerMdiIcons({
  "key-variant": mdiKeyVariant,
  "lock-outline": mdiLockOutline,
});

/**
 * Disable predicate that combines the form-wide `disabled` state with
 * the per-entry `locked` overlay used by featured components. Renderers
 * thread this through every `?disabled=...` binding so a board-pinned
 * field stays read-only even when the rest of the form is editable.
 */
export function effectiveDisabled(entry: ConfigEntry, ctx: RenderCtx): boolean {
  return ctx.disabled || entry.locked;
}

/** ESPHome stores secret references as `!secret <key>` literal strings
 *  in the YAML — match that shape so any string-shaped field can flag
 *  values that point at the secrets store. */
const SECRET_REF_RE = /^!secret\s+(\S+)\s*$/;

/** Render a small "Using stored secret: <name>" hint when the value
 *  is a `!secret <key>` reference. Returns `nothing` otherwise so
 *  callers can drop it inline without conditional wrapping. */
export function renderSecretHint(value: string, ctx: RenderCtx) {
  const match = value.match(SECRET_REF_RE);
  if (!match) return nothing;
  return html`<span class="secret-note">
    <wa-icon library="mdi" name="key-variant"></wa-icon>
    <span>${ctx.localize("device.value_from_secret")}</span>
    <code>${match[1]}</code>
  </span>`;
}

export interface RenderCtx {
  localize: LocalizeFunc;
  disabled: boolean;
  yaml: string;
  fromLine?: number;
  board: BoardCatalogEntry | null;
  requiredOnly: boolean;
  nestedOpenSections: Set<string>;
  getAt: (path: string[]) => unknown;
  errorAt: (path: string[]) => ValidationError | null;
  emitChange: (path: string[], value: unknown) => void;
  toggleNested: (key: string) => void;
  requestAddComponent: (domain: string) => void;
  scopeValues: (path: string[]) => Record<string, unknown>;
  filterRenderable: (
    entries: ConfigEntry[],
    values: Record<string, unknown>
  ) => ConfigEntry[];
  renderEntry: (entry: ConfigEntry, path: string[]) => unknown;
  /**
   * FLOAT_WITH_UNIT-only: stash a unit choice that the user picked
   * before typing a numeric value. The form doesn't serialize the
   * choice as YAML (a unit-only string isn't a valid value); instead
   * the renderer reads it on next paint so the picker stays on the
   * user's selection until they enter a number.
   */
  getPendingUnit: (path: string[]) => string | undefined;
  setPendingUnit: (path: string[], unit: string) => void;
  /**
   * FLOAT_WITH_UNIT-only: transient editing buffer for the numeric
   * input. `<input type="number">` reads `""` from `.value` while
   * the user is typing intermediate states (`"-"`, `"1e"`, `"1."`),
   * which would round-trip through serialize and reset the field
   * mid-typing. Renderers stash the raw text here and read it on
   * the next paint so partial input survives until the user types a
   * parseable value (or blurs the field).
   */
  getEditingMagnitude: (path: string[]) => string | undefined;
  setEditingMagnitude: (path: string[], text: string) => void;
  clearEditingMagnitude: (path: string[]) => void;
  /**
   * Stable per-form object identity used by renderers that keep
   * cross-render scratch state via a WeakMap (e.g. templatable
   * literal/lambda stashing — see ``templatable.ts``). The form
   * rebuilds the rest of the ctx every render so renderEntry /
   * emitChange / etc. are fresh closures and can't be used as
   * stable keys. ``stashOwner`` IS the host element itself.
   */
  stashOwner: object;
}

/**
 * Resolve the user-visible label for *entry* given a `localize`
 * function. Three-layer fallback:
 *
 * 1. `translation_key` resolved via `localize` (ignored when
 *    `localize` echoes the key back unchanged — the convention
 *    for "no translation registered").
 * 2. The catalog's English `entry.label`.
 * 3. The entry's `key`, prettified — `"update_interval"` →
 *    `"Update Interval"`.
 *
 * Pulled out of `labelFor()` so callers without a full
 * `RenderCtx` (e.g. the add-component dialog's hidden-validation
 * summary) can share the same chain.
 */
export function resolveEntryLabel(entry: ConfigEntry, localize: LocalizeFunc): string {
  if (entry.translation_key) {
    const params = (entry.translation_params || undefined) as
      | Record<string, string | number>
      | undefined;
    const translated = localize(entry.translation_key, params);
    if (translated && translated !== entry.translation_key) return translated;
  }
  if (entry.label) return entry.label;
  return entry.key
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function labelFor(entry: ConfigEntry, ctx: RenderCtx): string {
  return resolveEntryLabel(entry, ctx.localize);
}

export function renderHelpLink(entry: ConfigEntry, ctx: RenderCtx) {
  if (!entry.help_link) return nothing;
  return html`<a
    class="help-button"
    href=${entry.help_link}
    target="_blank"
    rel="noreferrer"
    title=${ctx.localize("device.docs")}
  >
    <wa-icon library="mdi" name="open-in-new"></wa-icon>
  </a>`;
}

export interface RenderLabelOptions {
  includeHelpLink?: boolean;
}

export function renderLabel(
  entry: ConfigEntry,
  ctx: RenderCtx,
  options: RenderLabelOptions = {}
) {
  const { includeHelpLink = true } = options;
  return html`
    <label class="field-label">
      ${labelFor(entry, ctx)}
      ${entry.required ? html`<span class="required">*</span>` : nothing}
      ${entry.locked
        ? html`<wa-icon
            class="lock-icon"
            library="mdi"
            name="lock-outline"
            title=${ctx.localize("device.field_locked_by_board")}
          ></wa-icon>`
        : nothing}
      ${includeHelpLink && entry.help_link ? renderHelpLink(entry, ctx) : nothing}
    </label>
    ${entry.description
      ? html`<p class="field-description">${renderMarkdown(entry.description)}</p>`
      : nothing}
  `;
}

export function renderFieldError(path: string[], ctx: RenderCtx) {
  const err = ctx.errorAt(path);
  return renderInlineError(err ? ctx.localize(err.code, err.params) : undefined);
}

/**
 * Wrap an input control in the standard field envelope:
 * `<div class="field" data-field-key>` + label + input + optional
 * trailing content (secret hint, suggestion picker badge) + error.
 *
 * Pulled out because every primitive renderer
 * (`renderStringField`, `renderNumberField`, `renderHexIntField`,
 * the password / suggestion-select branches, ...) repeated the
 * same shell verbatim. Centralising means a future tweak to the
 * field markup (an `aria-invalid` binding, a wrapper for
 * field-group spacing, ...) lands in one place instead of being
 * hand-applied to every renderer.
 *
 * `trailing` slots between the input and the error message — used
 * by the string renderer to drop in the `Using stored secret:`
 * hint when the value is a `!secret <key>` reference.
 */
export function renderFieldShell(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx,
  input: unknown,
  trailing: unknown = nothing
) {
  return html`
    <div class="field" data-field-key=${path.join(".")}>
      ${renderLabel(entry, ctx)} ${input} ${trailing} ${renderFieldError(path, ctx)}
    </div>
  `;
}

// Re-exported by `config-entry-renderers.ts`; placed here so the pin
// renderer can fall back to a string field without importing the
// barrel and creating a cycle.
export function renderStringField(
  entry: ConfigEntry,
  inputType: string,
  path: string[],
  ctx: RenderCtx
) {
  const value = String(ctx.getAt(path) ?? "");
  const invalid = ctx.errorAt(path) !== null;
  const placeholder = String(entry.default_value ?? "");
  const disabled = effectiveDisabled(entry, ctx);
  // When the entry carries a closed list of `suggestions`, render a
  // strict <wa-select> regardless of the underlying inputType — used
  // by featured components to pin the field to one of a few values
  // (e.g. a PIR pin to one of two FPC-connector GPIOs).
  if (entry.suggestions && entry.suggestions.length > 0) {
    return renderSuggestionSelect(entry, path, value, invalid, disabled, ctx);
  }
  // Password inputs render the dedicated component so they get a
  // reveal/hide toggle. Keeping the show-state inside the component
  // means the form's re-renders don't blow it away.
  if (inputType === "password") {
    return html`
      <div class="field" data-field-key=${path.join(".")}>
        ${renderLabel(entry, ctx)}
        <esphome-password-input
          .value=${value}
          .invalid=${invalid}
          .disabled=${disabled}
          .placeholder=${placeholder}
          @password-input-change=${(e: CustomEvent<PasswordInputValueChange>) =>
            ctx.emitChange(path, e.detail.value)}
        ></esphome-password-input>
        ${renderSecretHint(value, ctx)} ${renderFieldError(path, ctx)}
      </div>
    `;
  }
  return html`
    <div class="field" data-field-key=${path.join(".")}>
      ${renderLabel(entry, ctx)}
      <input
        type=${inputType}
        class=${invalid ? "invalid" : ""}
        .value=${value}
        ?disabled=${disabled}
        placeholder=${placeholder}
        @input=${(e: Event) => ctx.emitChange(path, (e.target as HTMLInputElement).value)}
      />
      ${renderSecretHint(value, ctx)} ${renderFieldError(path, ctx)}
    </div>
  `;
}

/**
 * Render a closed `<wa-select>` for entries carrying a `suggestions`
 * list (featured components only). Mirrors the strict-select branch of
 * `renderSelectField` in `config-entry-renderers.ts` but lives in the
 * shared module so the simple-field renderer can reuse it without
 * importing the barrel.
 */
function renderSuggestionSelect(
  entry: ConfigEntry,
  path: string[],
  value: string,
  invalid: boolean,
  disabled: boolean,
  ctx: RenderCtx
) {
  const valueLower = value.toLowerCase();
  const placeholder = String(entry.default_value ?? "");
  // Coerce the picked value back to the entry's declared type before
  // emitting — the wa-select hands us a string regardless, but a number
  // entry's YAML value must be a number or downstream validation
  // (and the backend's locked-value comparison) will reject it.
  const isNumeric =
    entry.type === ConfigEntryType.INTEGER || entry.type === ConfigEntryType.FLOAT;
  const coerce = (raw: string): string | number => {
    if (!isNumeric) return raw;
    if (raw === "") return raw;
    const n = entry.type === ConfigEntryType.INTEGER ? parseInt(raw, 10) : Number(raw);
    return Number.isFinite(n) ? n : raw;
  };
  return html`
    <div class="field" data-field-key=${path.join(".")}>
      ${renderLabel(entry, ctx)}
      <wa-select
        class=${invalid ? "invalid" : ""}
        ?disabled=${disabled}
        placeholder=${placeholder}
        @change=${(e: Event) =>
          ctx.emitChange(path, coerce((e.target as HTMLSelectElement).value))}
      >
        ${(entry.suggestions ?? []).map((s) => {
          const v = String(s);
          return html`<wa-option value=${v} ?selected=${v.toLowerCase() === valueLower}
            >${v}</wa-option
          >`;
        })}
      </wa-select>
      ${renderFieldError(path, ctx)}
    </div>
  `;
}
