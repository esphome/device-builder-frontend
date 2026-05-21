import { html } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import type { ConfigEntry } from "../../../api/types.js";
import { ConfigEntryType } from "../../../api/types.js";
import {
  chooseDisplayUnit,
  parseFloatWithUnit,
  placeholderForFloatWithUnit,
  serializeFloatWithUnit,
} from "../../../util/float-with-unit.js";
import { formatHexInt, parseHexInt } from "../../../util/hex-int.js";
import { parseYamlBoolean, YamlRawValue } from "../../../util/yaml-serialize.js";
import {
  effectiveDisabled,
  renderFieldError,
  renderFieldShell,
  renderHelpLink,
  renderLabel,
  renderStringField,
  type RenderCtx,
} from "../config-entry-renderers-shared.js";

export function renderNumberField(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx,
) {
  // A featured-entry preset can pin the choice to a short list — defer to
  // the suggestion-aware string renderer which converts back to number on change.
  if (entry.suggestions && entry.suggestions.length > 0) {
    return renderStringField(entry, "number", path, ctx);
  }
  if (entry.display_format === "hex") {
    return renderHexIntField(entry, path, ctx);
  }
  const value = String(ctx.getAt(path) ?? "");
  const invalid = ctx.errorAt(path) !== null;
  const min = entry.range ? String(entry.range[0]) : undefined;
  const max = entry.range ? String(entry.range[1]) : undefined;
  const disabled = effectiveDisabled(entry, ctx);
  return renderFieldShell(
    entry,
    path,
    ctx,
    html`<input
      type="number"
      class=${invalid ? "invalid" : ""}
      .value=${value}
      ?disabled=${disabled}
      min=${min ?? ""}
      max=${max ?? ""}
      step=${entry.type === ConfigEntryType.FLOAT ? "any" : "1"}
      placeholder=${String(entry.default_value ?? "")}
      @input=${(e: Event) => {
        const raw = (e.target as HTMLInputElement).value;
        ctx.emitChange(path, raw === "" ? "" : Number(raw));
      }}
    />`,
  );
}

// <input type="number"> rejects 0x… literals, so hex-typed fields
// (display_format=hex from cv.hex_uint*_t — every i2c address) need a text
// input with explicit hex parsing + display formatting. Round-trips to
// "0x" + lower-hex; accepts 0x76 / 0X76 (hex) and 118 (decimal).
function renderHexIntField(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx,
) {
  const rawValue = ctx.getAt(path);
  const invalid = ctx.errorAt(path) !== null;
  const disabled = effectiveDisabled(entry, ctx);
  // Prefer the in-progress edit buffer so intermediate typing states
  // ("0x", "0x7") aren't clobbered by a re-render that reformats empty
  // partial parses back to "". Mirrors the float-with-unit pattern.
  const editingText = ctx.getEditingMagnitude(path);
  const displayValue = editingText ?? hexDisplayOrFallback(rawValue);
  const placeholder = hexDisplayOrFallback(entry.default_value);
  return renderFieldShell(
    entry,
    path,
    ctx,
    html`<input
      type="text"
      autocomplete="off"
      spellcheck="false"
      class=${invalid ? "invalid" : ""}
      .value=${displayValue}
      ?disabled=${disabled}
      placeholder=${placeholder}
      @input=${(e: Event) => {
        const raw = (e.target as HTMLInputElement).value;
        ctx.setEditingMagnitude(path, raw);
        if (raw === "") {
          ctx.emitChange(path, "");
          return;
        }
        // Try parse + reformat — canonical "0x…" is what we want on disk.
        // If either fails (unparseable input, or a value formatHexInt rejects
        // — negative, NaN, fractional), fall through to the raw string so the
        // inline validator flags it instead of silently clearing.
        ctx.emitChange(path, formatHexInt(parseHexInt(raw)) || raw);
      }}
      @blur=${() => ctx.clearEditingMagnitude(path)}
    />`,
  );
}

// Returns "" for nullish/empty so the input clears normally; otherwise falls
// back to String(value) so a !lambda block or pasted text remains visible
// while the inline validator flags it.
function hexDisplayOrFallback(rawValue: unknown): string {
  if (rawValue === null || rawValue === undefined || rawValue === "") return "";
  return formatHexInt(rawValue) || String(rawValue);
}

/**
 * Time-period field: ESPHome accepts "<value><unit>" strings like
 * "5s" / "100ms" / "30min" / "1h" (and "5" = 5 seconds, "1h30s" =
 * compound — the latter is rare enough that we render it as a
 * plain text fallback when parsing fails).
 *
 * Splits the value into a numeric input + a unit picker so the
 * user never has to remember the suffix grammar. Serializes back
 * to a single "<value><unit>" string on every change so the
 * backend's parser handles it the same as if the user had typed
 * it raw into YAML.
 */
const TIME_PERIOD_UNITS = ["us", "ms", "s", "min", "h", "d"] as const;
type TimePeriodUnit = (typeof TIME_PERIOD_UNITS)[number];

function parseTimePeriod(raw: unknown): {
  value: string;
  unit: TimePeriodUnit;
  parseable: boolean;
} {
  if (raw === undefined || raw === null || raw === "") {
    return { value: "", unit: "s", parseable: true };
  }
  const text = String(raw).trim();
  // Single "<number><unit>" form. Number can be a fraction. Unit is
  // optional — a bare number is interpreted as seconds by ESPHome.
  const m = text.match(/^(\d+(?:\.\d+)?)(us|ms|s|min|h|d)?$/);
  if (m) {
    const [, num, suf] = m;
    return {
      value: num,
      unit: ((suf as TimePeriodUnit) ?? "s"),
      parseable: true,
    };
  }
  // Compound form ("1h30s") or unrecognised — surface the raw string
  // so the user can edit it as plain text without us mangling it.
  return { value: text, unit: "s", parseable: false };
}

function serializeTimePeriod(value: string, unit: TimePeriodUnit): string {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  return `${trimmed}${unit}`;
}

export function renderTimePeriodField(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx,
) {
  const raw = ctx.getAt(path);
  const parsed = parseTimePeriod(raw);
  const invalid = ctx.errorAt(path) !== null;
  const disabled = effectiveDisabled(entry, ctx);
  // Compound / unparseable strings fall through to a plain text
  // input so the user can keep editing the raw form they pasted.
  if (!parsed.parseable) {
    return renderStringField(entry, "text", path, ctx);
  }
  // Split the catalog's default ("5s") into its numeric prefix
  // for the placeholder — the magnitude input shows only the
  // number, the unit lives in the dropdown beside it.
  const defaultParsed =
    entry.default_value !== undefined && entry.default_value !== null
      ? parseTimePeriod(entry.default_value)
      : null;
  const placeholderText =
    defaultParsed && defaultParsed.parseable ? defaultParsed.value : "";
  // When the user hasn't touched the field yet, seed the unit
  // picker with the default's unit so the round-tripped widget
  // matches what they'd see if they typed the catalog default.
  const displayUnit =
    raw !== undefined && raw !== null && raw !== ""
      ? parsed.unit
      : defaultParsed?.parseable
        ? defaultParsed.unit
        : parsed.unit;
  return html`
    <div class="field time-period" data-field-key=${path.join(".")}>
      ${renderLabel(entry, ctx)}
      <div class="time-period-inputs">
        <input
          type="text"
          inputmode="decimal"
          class=${invalid ? "invalid" : ""}
          .value=${parsed.value}
          ?disabled=${disabled}
          placeholder=${placeholderText}
          @input=${(e: Event) => {
            const next = (e.target as HTMLInputElement).value;
            ctx.emitChange(path, serializeTimePeriod(next, displayUnit));
          }}
        />
        <wa-select
          data-no-value-sync
          ?disabled=${disabled}
          @change=${(e: Event) => {
            const nextUnit = (e.target as HTMLSelectElement)
              .value as TimePeriodUnit;
            ctx.emitChange(path, serializeTimePeriod(parsed.value, nextUnit));
          }}
        >
          ${TIME_PERIOD_UNITS.map(
            (u) => html`<wa-option
              value=${u}
              ?selected=${u === displayUnit}
              >${ctx.localize(`device.automation_action_delay_unit_${u}`)}</wa-option
            >`,
          )}
        </wa-select>
      </div>
      ${renderFieldError(path, ctx)}
    </div>
  `;
}

// YAML shape is a single "<value><unit>" string; render the two halves as
// separate controls and serialize back on every change. range constrains
// only the numeric part — omit when the picked unit isn't canonical to
// avoid spurious browser-level rejection on values that round-trip fine.
export function renderFloatWithUnitField(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx,
) {
  const unitOptions = entry.unit_options ?? [];
  const canonicalUnit = unitOptions[0] ?? "";
  const rawValue = ctx.getAt(path);
  const parsed = parseFloatWithUnit(rawValue, unitOptions);
  // Edit buffer survives intermediate typing states ("-", "1e", "1.") that
  // the parser turns into null/"". Cleared on blur and on entries change.
  const editingText = ctx.getEditingMagnitude(path);
  const numberValue =
    editingText ?? (parsed.value === null ? "" : String(parsed.value));
  const unit = chooseDisplayUnit(
    rawValue,
    entry.default_value,
    ctx.getPendingUnit(path),
    unitOptions,
  );
  const placeholder = placeholderForFloatWithUnit(
    entry.default_value,
    unitOptions,
  );
  const invalid = ctx.errorAt(path) !== null;
  const disabled = effectiveDisabled(entry, ctx);
  const isCanonical = unit === canonicalUnit;
  const min = entry.range && isCanonical ? String(entry.range[0]) : undefined;
  const max = entry.range && isCanonical ? String(entry.range[1]) : undefined;
  const emit = (next: { value: number | null; unit: string }) =>
    ctx.emitChange(path, serializeFloatWithUnit(next));
  return html`
    <div class="field float-with-unit" data-field-key=${path.join(".")}>
      ${renderLabel(entry, ctx)}
      <div class="float-with-unit-inputs">
        <input
          type="number"
          class=${invalid ? "invalid" : ""}
          .value=${numberValue}
          ?disabled=${disabled}
          min=${ifDefined(min)}
          max=${ifDefined(max)}
          step="any"
          placeholder=${placeholder}
          @input=${(e: Event) => {
            const raw = (e.target as HTMLInputElement).value;
            ctx.setEditingMagnitude(path, raw);
            // Clearing magnitude drops the unit (`{null, kHz}` serializes to "");
            // stash the unit so the next render's fallback doesn't snap back to canonical.
            if (raw === "") ctx.setPendingUnit(path, unit);
            const next = raw === "" ? null : Number(raw);
            emit({ value: Number.isFinite(next) ? next : null, unit });
          }}
          @blur=${() => ctx.clearEditingMagnitude(path)}
        />
        ${unitOptions.length > 1
          ? html`
              <wa-select
                data-no-value-sync
                ?disabled=${disabled}
                @change=${(e: Event) => {
                  const nextUnit = (e.target as HTMLSelectElement).value;
                  if (parsed.value === null) {
                    // Stash the unit — serializing {value:null, unit} emits ""
                    // and the next render's default would snap back to canonical.
                    ctx.setPendingUnit(path, nextUnit);
                  } else {
                    emit({ value: parsed.value, unit: nextUnit });
                  }
                }}
              >
                ${unitOptions.map(
                  (option) => html`<wa-option
                    value=${option}
                    ?selected=${option === unit}
                    >${option}</wa-option
                  >`,
                )}
              </wa-select>
            `
          : html`<span class="float-with-unit-suffix">${unit}</span>`}
      </div>
      ${renderFieldError(path, ctx)}
    </div>
  `;
}

// Fall back to entry.default_value when raw is undefined/null so default-true
// fields (esp32_ble_tracker.software_coexistence) reflect what ESPHome will
// actually apply at compile time — otherwise the user sees OFF on a field
// that's actually ON and saves a redundant explicit true:.
//
// Accept the full set of ESPHome YAML boolean spellings (true/yes/on/enable
// and their case variants) so a user-typed ``True`` or ``enable`` in the
// YAML editor reflects ON in the form view (issue device-builder#923).
export function renderBooleanField(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx,
) {
  const raw = ctx.getAt(path);
  const effective = raw === undefined || raw === null ? entry.default_value : raw;
  const checked = parseYamlBoolean(effective) === true;
  return html`
    <div class="switch-field" data-field-key=${path.join(".")}>
      <div class="field-info">
        ${renderLabel(entry, ctx, { includeHelpLink: false })}
      </div>
      ${renderHelpLink(entry, ctx)}
      <wa-switch
        ?checked=${checked}
        ?disabled=${effectiveDisabled(entry, ctx)}
        @change=${(e: Event) =>
          ctx.emitChange(
            path,
            (e.target as HTMLInputElement & { checked: boolean }).checked,
          )}
      ></wa-switch>
    </div>
  `;
}

export function renderSelectField(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx,
) {
  const value = String(ctx.getAt(path) ?? "");
  const invalid = ctx.errorAt(path) !== null;
  const disabled = effectiveDisabled(entry, ctx);
  // Featured suggestions override options — board author narrowed the choice.
  // Always strict select; suggestions are a closed set.
  if (entry.suggestions && entry.suggestions.length > 0) {
    const valueLower = value.toLowerCase();
    return html`
      <div class="field" data-field-key=${path.join(".")}>
        ${renderLabel(entry, ctx)}
        <wa-select
          class=${invalid ? "invalid" : ""}
          ?disabled=${disabled}
          placeholder=${String(entry.default_value ?? "")}
          @change=${(e: Event) =>
            ctx.emitChange(path, (e.target as HTMLSelectElement).value)}
        >
          ${entry.suggestions.map((s) => {
            const v = String(s);
            return html`<wa-option
              value=${v}
              ?selected=${v.toLowerCase() === valueLower}
              >${v}</wa-option
            >`;
          })}
        </wa-select>
        ${renderFieldError(path, ctx)}
      </div>
    `;
  }
  if (entry.allow_custom_value && entry.options && entry.options.length > 0) {
    const listId = `combobox-${path.join("-")}`;
    return html`
      <div class="field" data-field-key=${path.join(".")}>
        ${renderLabel(entry, ctx)}
        <input
          type="text"
          class="combobox-input ${invalid ? "invalid" : ""}"
          list=${listId}
          .value=${value}
          ?disabled=${disabled}
          placeholder=${String(entry.default_value ?? "")}
          @input=${(e: Event) =>
            ctx.emitChange(path, (e.target as HTMLInputElement).value)}
        />
        <datalist id=${listId}>
          ${entry.options.map(
            (opt) => html`<option value=${opt.value}>${opt.label}</option>`,
          )}
        </datalist>
        ${renderFieldError(path, ctx)}
      </div>
    `;
  }
  // Option values are sometimes stored case-differently than the YAML uses
  // (ESP32C6 vs esp32c6) — case-insensitive compare so the matching option
  // still flags as selected.
  const valueLower = value.toLowerCase();
  const defaultStr =
    entry.default_value != null ? String(entry.default_value) : "";
  const defaultOption = entry.options?.find(
    (o) => o.value.toLowerCase() === defaultStr.toLowerCase(),
  );
  const placeholder = defaultOption?.label ?? defaultStr;
  return html`
    <div class="field" data-field-key=${path.join(".")}>
      ${renderLabel(entry, ctx)}
      <wa-select
        class=${invalid ? "invalid" : ""}
        ?disabled=${disabled}
        placeholder=${placeholder}
        @change=${(e: Event) =>
          ctx.emitChange(path, (e.target as HTMLSelectElement).value)}
      >
        ${(entry.options ?? []).map(
          (opt) =>
            html`<wa-option
              value=${opt.value}
              ?selected=${opt.value.toLowerCase() === valueLower}
              >${opt.label}</wa-option
            >`,
        )}
      </wa-select>
      ${renderFieldError(path, ctx)}
    </div>
  `;
}

// YAML block-scalar values (lambda: |-) come through as YamlRawValue so the
// on-disk style round-trips. Re-wrap edited text as YamlRawValue so the |-
// marker survives the next save (#428).
export function renderTextareaField(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx,
) {
  const raw = ctx.getAt(path);
  const isRaw = raw instanceof YamlRawValue;
  const value = isRaw ? raw.body : String(raw ?? "");
  const invalid = ctx.errorAt(path) !== null;
  return html`
    <div class="field" data-field-key=${path.join(".")}>
      ${renderLabel(entry, ctx)}
      <textarea
        class="textarea-field ${invalid ? "invalid" : ""}"
        rows="4"
        ?disabled=${effectiveDisabled(entry, ctx)}
        .value=${value}
        placeholder=${String(entry.default_value ?? "")}
        @input=${(e: Event) => {
          const text = (e.target as HTMLTextAreaElement).value;
          ctx.emitChange(
            path,
            isRaw ? YamlRawValue.fromBodyText(text, raw) : text,
          );
        }}
      ></textarea>
      ${renderFieldError(path, ctx)}
    </div>
  `;
}

export function renderIconField(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx,
) {
  const value = String(ctx.getAt(path) ?? "");
  const invalid = ctx.errorAt(path) !== null;
  return html`
    <div class="field" data-field-key=${path.join(".")}>
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
