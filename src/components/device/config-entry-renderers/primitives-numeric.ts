import { html } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import type { ConfigEntry } from "../../../api/types/config-entries.js";
import { ConfigEntryType } from "../../../api/types/config-entries.js";
import {
  chooseDisplayUnit,
  defaultUnitForFloatWithUnit,
  parseFloatWithUnit,
  placeholderForFloatWithUnit,
  serializeFloatWithUnit,
  visibleUnitOptions,
} from "../../../util/float-with-unit.js";
import {
  coerceFloatFieldValue,
  coerceValueToEntryType,
} from "../../../util/coerce-entry-value.js";
import { formatHexInt, parseHexInt } from "../../../util/hex-int.js";
import { coerceIntFieldValue } from "../../../util/int-input.js";
import {
  parseTimePeriodScalar,
  serializeTimePeriod,
  TIME_PERIOD_UNITS,
  type TimePeriodUnit,
} from "../../../util/time-period.js";
import {
  effectiveDisabled,
  fieldKeyAttr,
  renderFieldError,
  renderFieldShell,
  renderLabel,
  renderStringField,
  renderUnparseableScalarField,
  renderYamlOnlyFallbackIfNonPrimitive,
  type RenderCtx,
} from "../config-entry-renderers-shared.js";

export function renderNumberField(entry: ConfigEntry, path: string[], ctx: RenderCtx) {
  // A featured-entry preset can pin the choice to a short list — defer to
  // the suggestion-aware string renderer which converts back to number on change.
  if (entry.suggestions && entry.suggestions.length > 0) {
    return renderStringField(entry, "number", path, ctx);
  }
  const raw = ctx.getAt(path);
  // Bail above the hex dispatch so the hex variant inherits the
  // guard without each renderer having to repeat the check.
  const bail = renderYamlOnlyFallbackIfNonPrimitive(entry, path, ctx, raw);
  if (bail) return bail;
  if (entry.display_format === "hex") {
    return renderHexIntField(entry, path, ctx);
  }
  if (entry.type === ConfigEntryType.INTEGER) {
    return renderIntField(entry, path, ctx);
  }
  // An unparseable primitive blanks inside <input type="number"> and reads
  // as unset; bail to the shared junk-scalar fallback.
  if (raw != null && !Number.isFinite(Number(String(raw)))) {
    return renderUnparseableScalarField(entry, path, ctx, raw);
  }
  // FLOAT keeps the native number spinner — floats don't take 0x… literals.
  const value = String(raw ?? "");
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
      step="any"
      placeholder=${String(entry.default_value ?? "")}
      @input=${(e: Event) => {
        const raw = (e.target as HTMLInputElement).value;
        ctx.emitChange(path, coerceValueToEntryType(entry, raw));
      }}
    />`
  );
}

// <input type="number"> rejects the 0x… literals cv.int_ accepts, so render
// integers as text and commit through the shared ``coerceIntFieldValue``
// (decimal → number, hex/other → verbatim string). The edit buffer keeps raw
// keystrokes on screen while typing so the committed value's reformatting
// (``0042`` → ``42``) doesn't fight the cursor; it clears on blur.
function renderIntField(entry: ConfigEntry, path: string[], ctx: RenderCtx) {
  const editingText = ctx.getEditingMagnitude(path);
  const value = editingText ?? String(ctx.getAt(path) ?? "");
  const invalid = ctx.errorAt(path) !== null;
  const disabled = effectiveDisabled(entry, ctx);
  return renderFieldShell(
    entry,
    path,
    ctx,
    html`<input
      type="text"
      autocomplete="off"
      spellcheck="false"
      class=${invalid ? "invalid" : ""}
      .value=${value}
      ?disabled=${disabled}
      placeholder=${String(entry.default_value ?? "")}
      @input=${(e: Event) => {
        const raw = (e.target as HTMLInputElement).value;
        ctx.setEditingMagnitude(path, raw);
        ctx.emitChange(path, coerceIntFieldValue(raw));
      }}
      @blur=${() => ctx.clearEditingMagnitude(path)}
    />`
  );
}

// <input type="number"> rejects 0x… literals, so hex-typed fields
// (display_format=hex from cv.hex_uint*_t — every i2c address) need a text
// input with explicit hex parsing + display formatting. Round-trips to
// "0x" + lower-hex; accepts 0x76 / 0X76 (hex) and 118 (decimal).
function renderHexIntField(entry: ConfigEntry, path: string[], ctx: RenderCtx) {
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
    />`
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
export function renderTimePeriodField(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx
) {
  const raw = ctx.getAt(path);
  // Bail above parseTimePeriodScalar — its ``String(raw).trim()`` would
  // turn a single-element list ``["5s"]`` into the parseable string
  // ``"5s"`` and a save would clobber the original list.
  const bail = renderYamlOnlyFallbackIfNonPrimitive(entry, path, ctx, raw);
  if (bail) return bail;
  const parsed = parseTimePeriodScalar(raw);
  const invalid = ctx.errorAt(path) !== null;
  const disabled = effectiveDisabled(entry, ctx);
  // Compound / unparseable values fall through to the shared fallback: a
  // string (a pasted "1h30m") stays editable as text; a non-string
  // primitive gets the YAML-only shell instead of a type-clobbering input.
  if (!parsed.parseable) {
    return renderUnparseableScalarField(entry, path, ctx, raw);
  }
  // Split the catalog's default ("5s") into its numeric prefix
  // for the placeholder — the magnitude input shows only the
  // number, the unit lives in the dropdown beside it.
  const defaultParsed =
    entry.default_value !== undefined && entry.default_value !== null
      ? parseTimePeriodScalar(entry.default_value)
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
    <div class="field time-period" data-field-key=${fieldKeyAttr(path)}>
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
            const nextUnit = (e.target as HTMLSelectElement).value as TimePeriodUnit;
            ctx.emitChange(path, serializeTimePeriod(parsed.value, nextUnit));
          }}
        >
          ${TIME_PERIOD_UNITS.map(
            (u) =>
              html`<wa-option value=${u} ?selected=${u === displayUnit}
                >${ctx.localize(`device.automation_action_delay_unit_${u}`)}</wa-option
              >`
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
  ctx: RenderCtx
) {
  const unitOptions = entry.unit_options ?? [];
  const canonicalUnit = unitOptions[0] ?? "";
  const rawValue = ctx.getAt(path);
  // Bail above parseFloatWithUnit — same data-loss shape as
  // renderTimePeriodField: a single-element list like ``["50Hz"]``
  // stringifies to a parseable scalar and a save would clobber it.
  const bail = renderYamlOnlyFallbackIfNonPrimitive(entry, path, ctx, rawValue);
  if (bail) return bail;
  const parsed = parseFloatWithUnit(rawValue, unitOptions);
  // Edit buffer survives intermediate typing states ("-", "1e", "1.") that
  // the parser turns into null/"". Cleared on blur and on entries change.
  const editingText = ctx.getEditingMagnitude(path);
  // A present value the parser can't split ("21C", "inf") would render as an
  // empty magnitude + unit picker and read as unset. Bail to the shared
  // junk-scalar fallback unless the user is mid-edit — the buffer
  // legitimately holds partial input.
  if (
    parsed.value === null &&
    editingText == null &&
    rawValue != null &&
    String(rawValue).trim() !== ""
  ) {
    return renderUnparseableScalarField(entry, path, ctx, rawValue);
  }
  const numberValue = editingText ?? (parsed.value === null ? "" : String(parsed.value));
  const unit = chooseDisplayUnit(
    rawValue,
    entry.default_value,
    ctx.getPendingUnit(path),
    unitOptions
  );
  // Narrow the picker to the field's scale; keep canonical/default/in-use so a
  // trimmed unit a value uses is never hidden (parsing uses the full list).
  const pickerUnitOptions = visibleUnitOptions(unitOptions, entry.range, [
    canonicalUnit,
    defaultUnitForFloatWithUnit(entry.default_value, unitOptions),
    unit,
  ]);
  const placeholder = placeholderForFloatWithUnit(entry.default_value, unitOptions);
  const invalid = ctx.errorAt(path) !== null;
  const disabled = effectiveDisabled(entry, ctx);
  const isCanonical = unit === canonicalUnit;
  const min = entry.range && isCanonical ? String(entry.range[0]) : undefined;
  const max = entry.range && isCanonical ? String(entry.range[1]) : undefined;
  const emit = (next: { value: number | null; unit: string }) =>
    ctx.emitChange(path, serializeFloatWithUnit(next));
  return html`
    <div class="field float-with-unit" data-field-key=${fieldKeyAttr(path)}>
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
            const next = coerceFloatFieldValue(raw);
            if (next === "") {
              // Clearing magnitude drops the unit (`{null, kHz}` serializes to "");
              // stash the unit so the next render's fallback doesn't snap back to canonical.
              ctx.setPendingUnit(path, unit);
              emit({ value: null, unit });
            } else if (typeof next === "number") {
              emit({ value: next, unit });
            } else {
              // Non-finite input ships verbatim so the validator flags it
              // instead of the serializer silently clearing the value (#1365).
              // The picked unit rides along: parseFloatWithUnit falls back to
              // the canonical unit on junk, so a bare "1e" would snap a kHz
              // field to Hz for the corrective keystroke that follows.
              ctx.emitChange(path, next + unit);
            }
          }}
          @blur=${() => ctx.clearEditingMagnitude(path)}
        />
        ${
          pickerUnitOptions.length > 1
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
                  ${pickerUnitOptions.map(
                    (option) =>
                      html`<wa-option value=${option} ?selected=${option === unit}
                        >${option}</wa-option
                      >`
                  )}
                </wa-select>
              `
            : html`<span class="float-with-unit-suffix">${unit}</span>`
        }
      </div>
      ${renderFieldError(path, ctx)}
    </div>
  `;
}
