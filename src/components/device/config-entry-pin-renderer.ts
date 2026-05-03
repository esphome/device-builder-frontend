/**
 * Pin selector renderer. Lifted out of `config-entry-renderers.ts`
 * because pin rendering carries its own per-option metadata
 * computation (in-use detection, input-only conflicts, supporting
 * text) that's heavier than every other field type.
 */

import { html, nothing, type TemplateResult } from "lit";
import type { BoardPin, ConfigEntry } from "../../api/types.js";
import { PinFeature, PinMode } from "../../api/types.js";
import {
  findUsedPins,
  sectionEndLine,
} from "../../util/config-entry-yaml-scan.js";
import {
  effectiveDisabled,
  renderFieldError,
  renderLabel,
  renderStringField,
  type RenderCtx,
} from "./config-entry-renderers-shared.js";

/**
 * Parse a pin reference into a GPIO number. Used both for the field's
 * current value and for individual `suggestions` entries. Featured
 * manifests write pins as bare ints (`12`), string forms (`"GPIO12"`,
 * `"gpio12"`), or — for fields whose locked preset needs the long-form
 * ESPHome pin block — an object like
 * `{ number: 0, mode: { input: true, pullup: true }, inverted: true }`
 * (Sonoff Basic's front-panel button is the canonical example: the pin
 * is occupied + inverted + needs the internal pull-up, all baked into
 * the preset). Returns `null` for anything we can't parse — the caller
 * drops those entries rather than letting a typo blank the dropdown.
 */
export function parsePinGpio(s: unknown): number | null {
  if (typeof s === "number" && Number.isFinite(s)) return s;
  if (typeof s === "string") {
    const m = s.match(/^\s*(?:GPIO)?(\d+)\s*$/i);
    if (m) return Number(m[1]);
  }
  if (s !== null && typeof s === "object" && !Array.isArray(s)) {
    return parsePinGpio((s as Record<string, unknown>).number);
  }
  return null;
}

interface PinOptionView {
  optValue: string;
  primary: string;
  secondary: string;
  titleText: string;
  inUse: boolean;
  disabled: boolean;
}

function buildPinOption(
  pin: BoardPin,
  entry: ConfigEntry,
  usedPins: Map<number, string>,
  ctx: RenderCtx,
): PinOptionView {
  const optValue = `GPIO${pin.gpio}`;
  const primary = pin.label || optValue;
  const occupiedBy = pin.occupied_by || "";
  const usedBy = usedPins.get(pin.gpio) || "";
  const needsOutput =
    entry.pin_mode === PinMode.OUTPUT ||
    entry.pin_mode === PinMode.INPUT_OUTPUT;
  const isInputOnly = pin.features.includes(PinFeature.INPUT_ONLY);
  const inputOnlyConflict = needsOutput && isInputOnly;
  const disabled = pin.available === false || inputOnlyConflict;
  const inUse = !!(occupiedBy || usedBy);

  const inUseText = occupiedBy
    ? ctx.localize("device.pin_occupied_by", { name: occupiedBy })
    : usedBy
      ? ctx.localize("device.pin_used_by", { name: usedBy })
      : "";
  const baseSupporting = inputOnlyConflict
    ? ctx.localize("device.pin_input_only")
    : pin.notes ||
      (pin.available === false ? ctx.localize("device.pin_unavailable") : "");

  const secondaryParts: string[] = [];
  if (pin.label && pin.label !== optValue) secondaryParts.push(optValue);
  if (inUseText) secondaryParts.push(inUseText);
  if (baseSupporting) secondaryParts.push(baseSupporting);

  return {
    optValue,
    primary,
    secondary: secondaryParts.join(" • "),
    titleText: [inUseText, baseSupporting].filter(Boolean).join(" — "),
    inUse,
    disabled,
  };
}

export function renderPinField(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx,
): TemplateResult {
  if (!ctx.board || ctx.board.pins.length === 0) {
    return renderStringField(entry, "text", path, ctx);
  }

  // Pin presets can land as bare ints (`12`), `GPIOn` strings, or the
  // long-form pin block (`{ number: N, mode: {...}, inverted: ... }`).
  // The wa-option values are always the `GPIOn` form, so normalise
  // before comparing or the disabled select renders blank.
  const rawValue = ctx.getAt(path);
  const valueGpio = parsePinGpio(rawValue);
  const value =
    valueGpio !== null ? `GPIO${valueGpio}` : String(rawValue ?? "");
  const invalid = ctx.errorAt(path) !== null;
  const required = entry.pin_features ?? [];
  const matchesFeatures = (pin: BoardPin) =>
    required.every((f) => pin.features.includes(f));
  let visible = ctx.board.pins.filter(matchesFeatures);
  // A featured-component preset can narrow the pin set further — e.g.
  // pin the ESK-1 PIR motion sensor to one of the two FPC-connector
  // GPIOs. Skip the narrowing if no parseable GPIOs survive (a manifest
  // typo shouldn't blank the dropdown — the user will see the full
  // feature-filtered set instead, with a visible error for the field).
  if (entry.suggestions && entry.suggestions.length > 0) {
    const allowed = new Set(
      entry.suggestions
        .map(parsePinGpio)
        .filter((g): g is number => g !== null),
    );
    if (allowed.size > 0) {
      const narrowed = visible.filter((p) => allowed.has(p.gpio));
      // Only apply the narrowing when at least one pin survives —
      // otherwise a manifest typo (suggestion lists a GPIO that doesn't
      // exist on the board, or one that fails the field's
      // `pin_features`) would render an empty dropdown with no escape
      // hatch. Prefer the feature-filtered superset so the user can
      // still configure the field.
      if (narrowed.length > 0) {
        visible = narrowed;
      }
    }
  }
  // The board's preset pin trumps generic feature filtering — a locked
  // GPIO12 (Sonoff relay) doesn't necessarily declare the same features
  // the underlying `switch.gpio` schema asks for, but the manifest is
  // authoritative. Make sure the active value's pin is always in the
  // dropdown so the disabled select still shows the right option.
  if (
    valueGpio !== null &&
    !visible.some((p) => p.gpio === valueGpio) &&
    ctx.board.pins.some((p) => p.gpio === valueGpio)
  ) {
    const pin = ctx.board.pins.find((p) => p.gpio === valueGpio)!;
    visible = [pin, ...visible];
  }
  const usedPins = findUsedPins(
    ctx.yaml,
    ctx.fromLine,
    sectionEndLine(ctx.yaml, ctx.fromLine),
  );
  const fieldDisabled = effectiveDisabled(entry, ctx);

  return html`
    <div class="field" data-field-key=${path.join(".")}>
      ${renderLabel(entry, ctx)}
      <wa-select
        class=${invalid ? "invalid" : ""}
        ?disabled=${fieldDisabled}
        @change=${(e: Event) =>
          ctx.emitChange(path, (e.target as HTMLSelectElement).value)}
      >
        ${visible.map((pin) => {
          const v = buildPinOption(pin, entry, usedPins, ctx);
          return html`<wa-option
            class="pin-option ${v.inUse ? "pin-option--warn" : ""}"
            value=${v.optValue}
            .label=${v.primary}
            ?selected=${v.optValue === value}
            ?disabled=${v.disabled}
            title=${v.titleText}
          >
            <span class="pin-option-stack">
              <span class="pin-option-primary">
                ${v.primary}
                ${v.inUse
                  ? html`<wa-icon
                      class="pin-warn-icon"
                      library="mdi"
                      name="alert-circle-outline"
                    ></wa-icon>`
                  : nothing}
              </span>
              ${v.secondary
                ? html`<span class="pin-option-secondary">${v.secondary}</span>`
                : nothing}
            </span>
          </wa-option>`;
        })}
      </wa-select>
      ${renderFieldError(path, ctx)}
    </div>
  `;
}
