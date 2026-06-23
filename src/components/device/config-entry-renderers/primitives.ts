import { html, nothing } from "lit";
import type { ConfigEntry } from "../../../api/types/config-entries.js";
import { chipNameToVariant } from "../../../util/chip-variant.js";
import { nearCanonicalOption } from "../../../util/config-validation.js";
import { parseYamlBoolean, YamlRawValue } from "../../../util/yaml-serialize.js";
import type { OptionsComboboxValueChange } from "../../options-combobox-event.js";
import {
  coerceValueToEntryType,
  effectiveDisabled,
  fieldKeyAttr,
  labelFor,
  renderFieldError,
  renderHelpLink,
  renderLabel,
  renderYamlOnlyFallbackIfNonPrimitive,
  type RenderCtx,
} from "../config-entry-renderers-shared.js";

// An empty-value "(none)" option marks an optional enum — surface a clear
// (×) and drop the pseudo-option. Memoized per entry (stable catalog object).
const _selectOptions = new WeakMap<
  ConfigEntry,
  { clearable: boolean; visibleOptions: NonNullable<ConfigEntry["options"]> }
>();

export function selectOptions(entry: ConfigEntry) {
  let cached = _selectOptions.get(entry);
  if (!cached) {
    const options = entry.options ?? [];
    cached = {
      clearable: options.some((o) => o.value === ""),
      visibleOptions: options.filter((o) => o.value !== ""),
    };
    _selectOptions.set(entry, cached);
  }
  return cached;
}

export {
  renderFloatWithUnitField,
  renderNumberField,
  renderTimePeriodField,
} from "./primitives-numeric.js";

// Fall back to entry.default_value when raw is undefined/null so default-true
// fields (esp32_ble_tracker.software_coexistence) reflect what ESPHome will
// actually apply at compile time — otherwise the user sees OFF on a field
// that's actually ON and saves a redundant explicit true:.
//
// Accept the full set of ESPHome YAML boolean spellings (true/yes/on/enable
// and their case variants) so a user-typed ``True`` or ``enable`` in the
// YAML editor reflects ON in the form view (issue device-builder#923).
export function renderBooleanField(entry: ConfigEntry, path: string[], ctx: RenderCtx) {
  const raw = ctx.getAt(path);
  // A list / mapping under a boolean-shaped catalog field renders
  // unchecked (``parseYamlBoolean`` returns null), but the first
  // user toggle emits ``true`` and clobbers the YAML structure.
  // Bail to the YAML-only notice instead.
  const bail = renderYamlOnlyFallbackIfNonPrimitive(entry, path, ctx, raw);
  if (bail) return bail;
  const effective = raw === undefined || raw === null ? entry.default_value : raw;
  const checked = parseYamlBoolean(effective) === true;
  return html`
    <div class="switch-field" data-field-key=${fieldKeyAttr(path)}>
      <div class="field-info">${renderLabel(entry, ctx, { includeHelpLink: false })}</div>
      ${renderHelpLink(entry, ctx)}
      <wa-switch
        ?checked=${checked}
        ?disabled=${effectiveDisabled(entry, ctx)}
        aria-label=${labelFor(entry, ctx)}
        @change=${(e: Event) =>
          ctx.emitChange(
            path,
            (e.target as HTMLInputElement & { checked: boolean }).checked
          )}
      ></wa-switch>
    </div>
  `;
}

// The device's ESP32 variant (lowercased, e.g. `esp32s3`), from the live
// `board:` sibling first (so a just-picked board resolves before `ctx.board`
// catches up) or the saved board. `""` when unknown or non-ESP32: per-variant
// options only exist on ESP32 components, so a non-`esp32*` result never
// filters.
function resolveEsp32Variant(ctx: RenderCtx): string {
  const board = String(ctx.getAt(["board"]) ?? "");
  const variant = (
    board ? chipNameToVariant(board) : (ctx.board?.esphome.variant ?? "")
  ).toLowerCase();
  return variant.startsWith("esp32") ? variant : "";
}

// Keep options whose `variants` is absent/empty or includes the device's
// variant — plus the currently-stored value, so a board swap can't hide what
// the YAML still holds. Falls back to all options when the variant is unknown or
// the filter would empty the select (e.g. psram on a no-PSRAM variant).
function filterOptionsByVariant<T extends { value: string; variants?: string[] }>(
  options: T[],
  variant: string,
  current = ""
): T[] {
  if (!variant) return options;
  const cur = current.toLowerCase();
  const kept = options.filter(
    (o) =>
      !o.variants?.length || o.variants.includes(variant) || o.value.toLowerCase() === cur
  );
  return kept.length > 0 ? kept : options;
}

// esp32's variant has no static default — it follows the chosen board, so the
// select shows the board's variant greyed out as the default. Only returns a
// value that's actually one of the entry's options.
function boardDerivedVariantDefault(
  entry: ConfigEntry,
  ctx: RenderCtx,
  variant: string
): string | undefined {
  if (!variant || entry.key !== "variant" || ctx.sectionKey !== "esp32") return undefined;
  return entry.options?.some((o) => o.value.toLowerCase() === variant)
    ? variant
    : undefined;
}

export function renderSelectField(entry: ConfigEntry, path: string[], ctx: RenderCtx) {
  const raw = ctx.getAt(path);
  const bail = renderYamlOnlyFallbackIfNonPrimitive(entry, path, ctx, raw);
  if (bail) return bail;
  const value = String(raw ?? "");
  const invalid = ctx.errorAt(path) !== null;
  const disabled = effectiveDisabled(entry, ctx);
  // Featured suggestions override options — board author narrowed the choice.
  // Always strict select; suggestions are a closed set.
  if (entry.suggestions && entry.suggestions.length > 0) {
    const valueLower = value.toLowerCase();
    return html`
      <div class="field" data-field-key=${fieldKeyAttr(path)}>
        ${renderLabel(entry, ctx)}
        <wa-select
          class=${invalid ? "invalid" : ""}
          ?disabled=${disabled}
          placeholder=${String(entry.default_value ?? "")}
          @change=${(e: Event) =>
            ctx.emitChange(path, (e.target as unknown as { value: string }).value)}
        >
          ${entry.suggestions.map((s) => {
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
  // The device's ESP32 variant, used to filter per-variant options (and derive
  // the esp32 variant default below); resolved once per render.
  const variant = resolveEsp32Variant(ctx);
  if (entry.allow_custom_value && entry.options && entry.options.length > 0) {
    // A custom value that matches a canonical option by case only (`l` vs the
    // catalog's `L`) compiles but breaks downstream unit recognition; nudge
    // toward the canonical spelling without blocking submit.
    const suggestion = nearCanonicalOption(value, entry.options);
    // ``label`` only names the combobox's shadow-DOM input (renderLabel's
    // visible label isn't associated via for=); the combobox draws no label
    // chrome of its own, so this isn't a duplicate visible label.
    return html`
      <div class="field" data-field-key=${fieldKeyAttr(path)}>
        ${renderLabel(entry, ctx)}
        <esphome-options-combobox
          .options=${filterOptionsByVariant(entry.options, variant, value)}
          .value=${value}
          label=${entry.label}
          placeholder=${String(entry.default_value ?? "")}
          .defaultValue=${String(entry.default_value ?? "")}
          .defaultNote=${ctx.localize("device.default_option_tag")}
          ?disabled=${disabled}
          ?invalid=${invalid}
          @options-combobox-change=${(e: CustomEvent<OptionsComboboxValueChange>) =>
            ctx.emitChange(path, coerceValueToEntryType(entry, e.detail.value))}
        ></esphome-options-combobox>
        ${renderFieldError(path, ctx)}
        ${suggestion
          ? html`<span class="field-warning" role="status"
              >${ctx.localize("validation.did_you_mean", { suggestion })}</span
            >`
          : nothing}
      </div>
    `;
  }
  // Option values are sometimes stored case-differently than the YAML uses
  // (ESP32C6 vs esp32c6) — case-insensitive compare so the matching option
  // still flags as selected.
  const valueLower = value.toLowerCase();
  const defaultStr =
    boardDerivedVariantDefault(entry, ctx, variant) ??
    (entry.default_value != null ? String(entry.default_value) : "");
  const defaultLower = defaultStr.toLowerCase();
  const defaultOption = entry.options?.find(
    (o) => o.value.toLowerCase() === defaultLower
  );
  const placeholder = defaultOption?.label ?? defaultStr;
  const { clearable, visibleOptions } = selectOptions(entry);
  // Filtered after the (entry-keyed) selectOptions memo since it depends on the board.
  const shownOptions = filterOptionsByVariant(visibleOptions, variant, value);
  return html`
    <div class="field" data-field-key=${fieldKeyAttr(path)}>
      ${renderLabel(entry, ctx)}
      <wa-select
        class=${invalid ? "invalid" : ""}
        ?disabled=${disabled}
        .withClear=${clearable}
        placeholder=${placeholder}
        @change=${(e: Event) =>
          ctx.emitChange(path, (e.target as unknown as { value: string }).value)}
      >
        ${clearable
          ? html`<wa-icon slot="clear-icon" library="mdi" name="close"></wa-icon>`
          : nothing}
        ${shownOptions.map((opt) => {
          const selected = opt.value.toLowerCase() === valueLower;
          const isDefault = defaultStr !== "" && opt.value.toLowerCase() === defaultLower;
          if (!isDefault) {
            return html`<wa-option value=${opt.value} ?selected=${selected}
              >${opt.label}</wa-option
            >`;
          }
          // wa-select activates the first option when nothing is committed,
          // so give the default a muted second line (like the pin menu's
          // notes) — the honest "this applies if you leave it" signal.
          // `.label` keeps the closed control showing just the label.
          return html`<wa-option
            value=${opt.value}
            .label=${opt.label}
            ?selected=${selected}
          >
            <span class="option-default-stack">
              <span>${opt.label}</span>
              <small class="option-default-note"
                >${ctx.localize("device.default_option_tag")}</small
              >
            </span>
          </wa-option>`;
        })}
      </wa-select>
      ${renderFieldError(path, ctx)}
    </div>
  `;
}

// YAML block-scalar values (lambda: |-) come through as YamlRawValue so the
// on-disk style round-trips. Re-wrap edited text as YamlRawValue so the |-
// marker survives the next save (#428).
export function renderTextareaField(entry: ConfigEntry, path: string[], ctx: RenderCtx) {
  const raw = ctx.getAt(path);
  const isRaw = raw instanceof YamlRawValue;
  // YamlRawValue is an intentional textarea shape (block scalars
  // like ``|-``); anything else non-primitive (a list / mapping
  // that landed under a textarea-shaped field) should bail rather
  // than coerce through ``String(...)``.
  if (!isRaw) {
    const bail = renderYamlOnlyFallbackIfNonPrimitive(entry, path, ctx, raw);
    if (bail) return bail;
  }
  const value = isRaw ? raw.body : String(raw ?? "");
  const invalid = ctx.errorAt(path) !== null;
  return html`
    <div class="field" data-field-key=${fieldKeyAttr(path)}>
      ${renderLabel(entry, ctx)}
      <textarea
        class="textarea-field ${invalid ? "invalid" : ""}"
        rows="4"
        ?disabled=${effectiveDisabled(entry, ctx)}
        .value=${value}
        placeholder=${String(entry.default_value ?? "")}
        @input=${(e: Event) => {
          const text = (e.target as HTMLTextAreaElement).value;
          ctx.emitChange(path, isRaw ? YamlRawValue.fromBodyText(text, raw) : text);
        }}
      ></textarea>
      ${renderFieldError(path, ctx)}
    </div>
  `;
}

export function renderIconField(entry: ConfigEntry, path: string[], ctx: RenderCtx) {
  const raw = ctx.getAt(path);
  const bail = renderYamlOnlyFallbackIfNonPrimitive(entry, path, ctx, raw);
  if (bail) return bail;
  const value = String(raw ?? "");
  const invalid = ctx.errorAt(path) !== null;
  return html`
    <div class="field" data-field-key=${fieldKeyAttr(path)}>
      ${renderLabel(entry, ctx)}
      <esphome-mdi-icon-picker
        .value=${value}
        .invalid=${invalid}
        .disabled=${effectiveDisabled(entry, ctx)}
        .placeholder=${String(entry.default_value ?? "Choose an icon…")}
        @change=${(e: CustomEvent<{ value: string }>) =>
          ctx.emitChange(path, e.detail.value)}
      ></esphome-mdi-icon-picker>
      ${renderFieldError(path, ctx)}
    </div>
  `;
}
