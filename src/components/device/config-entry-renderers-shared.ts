/**
 * Shared types + helpers used by every ConfigEntry renderer. Kept in
 * its own module so the simple-field, pin, and id-reference renderers
 * can import from one place without circular dependencies through the
 * barrel.
 */

import {
  mdiAlertCircleOutline,
  mdiCodeBraces,
  mdiKeyVariant,
  mdiLockOutline,
} from "@mdi/js";
import { html, nothing } from "lit";
import type { BoardCatalogEntry } from "../../api/types/boards.js";
import type { ConfigEntry } from "../../api/types/config-entries.js";
import { ConfigEntryType } from "../../api/types/config-entries.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { inputStyles } from "../../styles/inputs.js";
import { espHomeStyles } from "../../styles/shared.js";
import type { ComponentProvider } from "../../util/config-entry-yaml-scan.js";
import type { ValidationError } from "../../util/config-validation.js";
import { renderMarkdown } from "../../util/markdown.js";
import { isPrimitiveOrNullish } from "../../util/nested-values.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { renderInlineError } from "../../util/render-error.js";
import {
  isSecretEligible,
  recommendedSecretKeys,
} from "../../util/secret-eligibility.js";
import {
  hasSubstitutionReference,
  resolveSubstitutions,
} from "../../util/substitutions.js";
import { configEntryFormExtraStyles } from "./config-entry-form-extra.styles.js";
import { configEntryFormStyles } from "./config-entry-form.styles.js";
import { filterRenderable, renderFilterOptions } from "./config-entry-render-filter.js";
import { literalLambdaToggleStyles } from "./config-entry-renderers/literal-lambda-toggle.js";
import { fieldHighlightStyles } from "./field-highlight.styles.js";
import type { PasswordInputValueChange } from "./password-input.js";
// Type-only — the `<esphome-secret-picker>` element is registered by the
// form host (`config-entry-form.ts`). Keeping this module free of the
// element's DOM-dependent side-effect import lets the renderer unit tests
// run under the lightweight node environment.
import type { SecretSelectedDetail } from "./secret-picker.js";

/** Stylesheets every element that hosts ``ctx.renderEntry`` output
 *  needs in its shadow root: field shell, input styling, and the
 *  layout rules for compound widgets (``.time-period-inputs``,
 *  ``.nested-fields``, …) the per-field renderers emit. */
export const fieldRendererStyles = [
  espHomeStyles,
  inputStyles,
  configEntryFormStyles,
  configEntryFormExtraStyles,
  literalLambdaToggleStyles,
  fieldHighlightStyles,
];

registerMdiIcons({
  "alert-circle-outline": mdiAlertCircleOutline,
  "code-braces": mdiCodeBraces,
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

/** Serialize a field path into the ``data-field-key`` attribute. JSON
 *  (not ``path.join(".")``) so a user-supplied map key that itself
 *  contains a dot (a ``logger.logs`` row keyed ``i2c.idf``) survives
 *  the round-trip back to a path in ``parseFieldKey``. */
export const fieldKeyAttr = (path: string[]): string => JSON.stringify(path);

/** Recover a field path from a ``data-field-key`` attribute. Non-JSON
 *  values (the pin-advanced toggle key) fall back to dot-splitting. */
export const parseFieldKey = (attr: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(attr);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // not JSON — legacy / non-path attribute, fall through
  }
  return attr ? attr.split(".") : [];
};

/** ESPHome stores secret references as `!secret <key>` literal strings
 *  in the YAML — match that shape so any string-shaped field can flag
 *  values that point at the secrets store. */
const SECRET_REF_RE = /^!secret\s+(\S+)\s*$/;

/** The key a `!secret <key>` value points at, or ``null`` if not a ref. */
export function secretRefKey(value: string): string | null {
  return value.match(SECRET_REF_RE)?.[1] ?? null;
}

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

/**
 * Hint beneath a string field referencing a ``${var}``: previews the
 * value when it resolves against this file's ``substitutions:``, else a
 * marker whose tooltip notes the reference is resolved at build time
 * (from a package/include), not previewed here. ``nothing`` with no ref.
 */
export function renderSubstitutionHint(value: string, ctx: RenderCtx) {
  if (!hasSubstitutionReference(value)) return nothing;
  const resolved = resolveSubstitutions(value, ctx.substitutions);
  if (hasSubstitutionReference(resolved)) {
    const hint = ctx.localize("device.substitution_unresolved_hint");
    return html`<span
      class="substitution-note substitution-note--external"
      role="note"
      aria-label=${hint}
      title=${hint}
    >
      <wa-icon library="mdi" name="code-braces"></wa-icon>
      <wa-icon
        class="substitution-warn"
        library="mdi"
        name="alert-circle-outline"
      ></wa-icon>
      <span>${ctx.localize("device.substitution_unresolved")}</span>
    </span>`;
  }
  const label = ctx.localize("device.substitution_resolves_to");
  return html`<span
    class="substitution-note"
    role="note"
    aria-label=${`${label}: ${resolved}`}
    title=${label}
  >
    <wa-icon library="mdi" name="code-braces"></wa-icon>
    <code>${resolved}</code>
  </span>`;
}

export interface RenderCtx {
  localize: LocalizeFunc;
  disabled: boolean;
  yaml: string;
  /** Parsed ``substitutions:`` for ``yaml``; built once per render so
   *  referencing fields share one parse. */
  substitutions: Map<string, string>;
  fromLine?: number;
  /** Section being edited (``light.esp32_rmt_led_strip``,
   *  ``sensor.template``, …). Empty when the form runs outside a
   *  section context. The REGISTRY_LIST renderer reads this to
   *  scope its picker against ``applies_to`` so a sensor's filter
   *  dropdown doesn't offer binary_sensor filters. */
  sectionKey: string;
  /** Backend-resolved ESPHome node name (substitutions already expanded) for
   *  the device being edited; the hostname for per-device secret keys
   *  (``<hostname>__ota_password``). Empty outside a device context (e.g. the
   *  add-component preview). */
  deviceName?: string;
  board: BoardCatalogEntry | null;
  /** ``{provider_key: [allowed_mode_flags]}`` scoping the long-form pin Mode
   *  checkboxes per external provider; absent provider / native pin → all flags. */
  pinRegistryModes?: Record<string, string[]>;
  requiredOnly: boolean;
  /** Whether the section's advanced fields are shown. Read by
   *  ``renderChildEntries({ includeAdvanced })`` so an exclusive-group's
   *  chosen member can reveal all its fields regardless of the toggle. */
  showAdvanced: boolean;
  /** Top-level component keys present in the YAML — for the
   *  ``depends_on_component`` visibility predicate when filtering directly. */
  presentComponents: Set<string>;
  nestedOpenSections: Set<string>;
  getAt: (path: string[]) => unknown;
  errorAt: (path: string[]) => ValidationError | null;
  emitChange: (path: string[], value: unknown) => void;
  toggleNested: (key: string) => void;
  /** Open *key* once as a default (e.g. a pin disclosure with long-form
   *  values), without overriding a later explicit user collapse. */
  seedNestedOpen: (key: string) => void;
  requestAddComponent: (domain: string) => void;
  /**
   * Providers of a cross-domain interface reference. Returns synchronously
   * from a per-form cache; a miss kicks an async catalog fetch and
   * re-renders. Empty until loaded, and ``[]`` for a same-domain reference.
   */
  resolveInterfaceProviders: (interfaceName: string) => ReadonlyArray<ComponentProvider>;
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
    <div class="field" data-field-key=${fieldKeyAttr(path)}>
      ${renderLabel(entry, ctx)} ${input} ${trailing} ${renderFieldError(path, ctx)}
    </div>
  `;
}

/** Defensive bail for scalar field renderers: when the value at *path*
 *  isn't a primitive (a YAML list or mapping that landed under a
 *  scalar-shaped catalog field because the upstream schema bundle
 *  missed ``is_list`` or a similar shape marker), refuse to render an
 *  editable input. ``String([...])`` would silently coerce the list
 *  to a comma-joined string and a save would clobber the user's value.
 *  Returns the bail template, or ``null`` when *raw* is safe to coerce. */
export function renderYamlOnlyFallbackIfNonPrimitive(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx,
  raw: unknown
) {
  if (isPrimitiveOrNullish(raw)) return null;
  return renderYamlOnlyField(entry, path, ctx);
}

/** The "this value can only be edited in YAML" field shell — shown when a
 *  value's shape (a mapping, or a list whose items are mappings) can't be
 *  driven by the scalar/multi-value inputs. */
export function renderYamlOnlyField(entry: ConfigEntry, path: string[], ctx: RenderCtx) {
  return html`
    <div class="field" data-field-key=${fieldKeyAttr(path)}>
      ${renderLabel(entry, ctx)}
      <p class="field-description">${ctx.localize("device.value_yaml_only")}</p>
      ${renderFieldError(path, ctx)}
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
  const raw = ctx.getAt(path);
  const bail = renderYamlOnlyFallbackIfNonPrimitive(entry, path, ctx, raw);
  if (bail) return bail;
  const value = String(raw ?? "");
  const invalid = ctx.errorAt(path) !== null;
  const placeholder = String(entry.default_value ?? "");
  const disabled = effectiveDisabled(entry, ctx);
  // Inline `!secret` picker for concealed fields (password inputs) plus
  // the non-concealed exceptions in the allowlist (WiFi SSID).
  const secretEligible =
    inputType === "password" || isSecretEligible(ctx.sectionKey, entry.key);
  const selectedKey = secretRefKey(value);
  // When the field references a secret, the picker IS the field: hide the
  // (meaningless, masked) manual input and let the picker span the row.
  // The user reverts to a typed value via the picker's "manual" action.
  const secretMode = secretEligible && selectedKey !== null;
  const recommendedKeys = secretEligible
    ? recommendedSecretKeys(
        ctx.sectionKey,
        entry.key,
        ctx.deviceName ?? "",
        inputType === "password"
      )
    : [];
  const secretPicker = secretEligible
    ? html`<esphome-secret-picker
        ?full=${secretMode}
        .disabled=${disabled}
        .fieldLabel=${labelFor(entry, ctx)}
        .selectedKey=${selectedKey ?? ""}
        .value=${value}
        .deviceName=${ctx.deviceName ?? ""}
        .recommendedKeys=${recommendedKeys}
        @secret-selected=${(e: CustomEvent<SecretSelectedDetail>) =>
          ctx.emitChange(path, e.detail.value)}
      ></esphome-secret-picker>`
    : nothing;
  // Wrap an input with the picker beside it, or swap it out entirely in
  // secret mode. Plain input when the field isn't secret-eligible.
  const withPicker = (input: unknown) =>
    !secretEligible
      ? input
      : secretMode
        ? secretPicker
        : html`<div class="field-input-row">${input}${secretPicker}</div>`;
  // Picker doubles as the secret indicator; only the no-picker path hints.
  const secretHint = secretPicker === nothing ? renderSecretHint(value, ctx) : nothing;
  // Never preview the resolved value for concealed fields — a secret kept
  // in `substitutions:` (e.g. a WiFi/API password) must not leak in plaintext.
  const subHint = inputType === "password" ? nothing : renderSubstitutionHint(value, ctx);
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
    const passwordInput = html`<esphome-password-input
      .value=${value}
      .invalid=${invalid}
      .disabled=${disabled}
      .placeholder=${placeholder}
      @password-input-change=${(e: CustomEvent<PasswordInputValueChange>) =>
        ctx.emitChange(path, e.detail.value)}
    ></esphome-password-input>`;
    return html`
      <div class="field" data-field-key=${fieldKeyAttr(path)}>
        ${renderLabel(entry, ctx)} ${withPicker(passwordInput)} ${secretHint}
        ${renderFieldError(path, ctx)}
      </div>
    `;
  }
  const textInput = html`<input
    type=${inputType}
    class=${invalid ? "invalid" : ""}
    .value=${value}
    ?disabled=${disabled}
    placeholder=${placeholder}
    @input=${(e: Event) => ctx.emitChange(path, (e.target as HTMLInputElement).value)}
  />`;
  return html`
    <div class="field" data-field-key=${fieldKeyAttr(path)}>
      ${renderLabel(entry, ctx)} ${withPicker(textInput)} ${secretHint} ${subHint}
      ${renderFieldError(path, ctx)}
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
    <div class="field" data-field-key=${fieldKeyAttr(path)}>
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

// Shared child rendering for the nested renderer and the exclusive-group
// dropdown. ``includeAdvanced`` forces advanced children visible — a picked
// exclusive member's fields must all show, as it has no per-member toggle.
export function renderChildEntries(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx,
  opts: { includeAdvanced?: boolean } = {}
) {
  const values = ctx.scopeValues(path);
  const children = opts.includeAdvanced
    ? filterRenderable(
        entry.config_entries ?? [],
        values,
        renderFilterOptions(ctx, { showAdvanced: true })
      )
    : ctx.filterRenderable(entry.config_entries ?? [], values);
  return children.map((child) => ctx.renderEntry(child, [...path, child.key]));
}
