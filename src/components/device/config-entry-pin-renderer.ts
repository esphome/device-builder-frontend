/**
 * Pin selector renderer. Lifted out of `config-entry-renderers.ts`
 * because pin rendering carries its own per-option metadata
 * computation (in-use detection, input-only conflicts, supporting
 * text) that's heavier than every other field type.
 */

import { html, nothing, type TemplateResult } from "lit";
import type { BoardPin, ConfigEntry } from "../../api/types.js";
import { PinFeature, PinMode } from "../../api/types.js";
import { findUsedPins, sectionEndLine } from "../../util/config-entry-yaml-scan.js";
import { isPlainObject, isPrimitiveOrNullish } from "../../util/nested-values.js";
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
  ctx: RenderCtx
): PinOptionView {
  const optValue = `GPIO${pin.gpio}`;
  const primary = pin.label || optValue;
  const occupiedBy = pin.occupied_by || "";
  const usedBy = usedPins.get(pin.gpio) || "";
  const needsOutput =
    entry.pin_mode === PinMode.OUTPUT || entry.pin_mode === PinMode.INPUT_OUTPUT;
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
  ctx: RenderCtx
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
  // Fallback to ``String(rawValue)`` only when the value is a
  // primitive — js-yaml emits null-prototype maps for partial /
  // mid-edit pin blocks, and ``String(Object.create(null))`` throws
  // "Cannot convert object to primitive value", crashing the form
  // for a pin renderer that's already in a recoverable state. Treat
  // unparseable objects as "no selection" so no option matches and
  // the dropdown stays empty rather than blowing up.
  const value =
    valueGpio !== null
      ? `GPIO${valueGpio}`
      : isPrimitiveOrNullish(rawValue)
        ? String(rawValue ?? "")
        : "";
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
      entry.suggestions.map(parsePinGpio).filter((g): g is number => g !== null)
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
    sectionEndLine(ctx.yaml, ctx.fromLine)
  );
  const fieldDisabled = effectiveDisabled(entry, ctx);
  const isLongForm = isPlainObject(rawValue);

  // Pin-select onChange routes to ``path.number`` when the field is
  // already in long form (the user expanded Advanced and set a flag,
  // promoting ``pin: GPIO5`` to ``pin: { number: GPIO5, mode: ... }``)
  // and to bare ``path`` otherwise. Without this branch, picking a
  // different GPIO on a long-form pin would overwrite the whole
  // mapping (mode flags + inverted) with the GPIO string — silently
  // discarding every Advanced setting the user just configured.
  const onPinChange = (e: Event) => {
    const newGpio = (e.target as HTMLSelectElement).value;
    if (isLongForm) {
      ctx.emitChange([...path, "number"], newGpio);
    } else {
      ctx.emitChange(path, newGpio);
    }
  };

  return html`
    <div class="field" data-field-key=${path.join(".")}>
      ${renderLabel(entry, ctx)}
      <wa-select
        data-no-value-sync
        class=${invalid ? "invalid" : ""}
        ?disabled=${fieldDisabled}
        @change=${onPinChange}
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
      ${renderPinAdvanced(entry, path, ctx, rawValue, isLongForm, fieldDisabled)}
    </div>
  `;
}

/**
 * Render the "Advanced" disclosure carrying the long-form pin
 * fields (``mode`` flag group + ``inverted``) attached by
 * ``script/sync_components.py``'s ``_pin_long_form_extras``
 * (esphome/device-builder#430). ESPHome accepts both forms:
 *
 *     pin: GPIO5          # short form — what the picker writes
 *     pin:                # long form — what flipping any flag promotes to
 *       number: GPIO5
 *       mode:
 *         pullup: true
 *       inverted: false
 *
 * Without this disclosure the visual editor only ever writes the
 * short form, and configurations that need a pull-up (issue #420)
 * have no path through the editor.
 *
 * Returns ``nothing`` when the entry has no nested config_entries —
 * pre-#430 catalogs (or future entries that opt out by clearing
 * ``config_entries``) keep the simple short-form picker.
 */
function renderPinAdvanced(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx,
  rawValue: unknown,
  isLongForm: boolean,
  fieldDisabled: boolean
): TemplateResult | typeof nothing {
  // Apply the same visibility filter every other nested renderer
  // uses so requiredOnly / showAdvanced / platform-gating rules
  // hide long-form sub-fields the user shouldn't see (e.g. an
  // analog-mode flag on a platform that lacks it). Skipping
  // ``filterRenderable`` would let the long-form disclosure leak
  // sub-fields the rest of the form has hidden.
  const longFormFields = ctx.filterRenderable(
    entry.config_entries ?? [],
    ctx.scopeValues(path)
  );
  if (longFormFields.length === 0) return nothing;

  const advancedKey = `${path.join(".")}:pin-advanced`;
  // Reuse the form's ``nestedOpenSections`` machinery so the
  // open/closed state survives a re-render and follows the same
  // semantics as a regular ``nested`` group's expand toggle.
  // Default closed — the long-form fields are an opt-in
  // disclosure, never on the main form.
  const isOpen = ctx.nestedOpenSections.has(advancedKey);

  const onAdvancedToggle = () => {
    // Locked / disabled fields (board-preset pins, parent-disabled
    // groups) must not mutate via Advanced — without this guard,
    // opening the disclosure on a short-form locked pin would fire
    // the promotion ``emitChange`` and rewrite the locked value to
    // the long form. The toggle is also rendered ``disabled`` below,
    // but defending in both places means a synthetic click event
    // (test code, accessibility tooling) can't bypass the guard.
    if (fieldDisabled) return;
    ctx.toggleNested(advancedKey);
    // When opening for the first time on a short-form pin value,
    // promote ``pin: GPIO5`` → ``pin: { number: GPIO5 }`` so a
    // subsequent flag flip can write to ``pin.mode.pullup``
    // without ``setIn`` clobbering the GPIO. The form's
    // value-change handler picks this up before the children
    // render, so the nested fields read off the freshly-promoted
    // mapping. Skip when already long-form (preserves the
    // user's existing flags) or when the pin has no value yet
    // (no GPIO to preserve; the picker will write to bare path
    // on first selection).
    if (!isOpen && !isLongForm && rawValue != null && rawValue !== "") {
      ctx.emitChange(path, { number: rawValue });
    }
  };

  return html`
    <div class="pin-advanced" data-field-key="${advancedKey}">
      <button
        type="button"
        class="pin-advanced-toggle"
        aria-expanded=${isOpen}
        ?disabled=${fieldDisabled}
        @click=${onAdvancedToggle}
      >
        <wa-icon library="mdi" name=${isOpen ? "chevron-up" : "chevron-down"}></wa-icon>
        <span>${ctx.localize("device.pin_advanced")}</span>
      </button>
      ${isOpen
        ? html`<div class="pin-advanced-fields">
            ${longFormFields.map((child) => ctx.renderEntry(child, [...path, child.key]))}
          </div>`
        : nothing}
    </div>
  `;
}
