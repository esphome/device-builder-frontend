/**
 * Pin selector renderer. Lifted out of `config-entry-renderers.ts`
 * because pin rendering carries its own per-option metadata
 * computation (in-use detection, input-only conflicts, supporting
 * text) that's heavier than every other field type.
 */

import { html, nothing, type TemplateResult } from "lit";
import type { BoardPin } from "../../api/types/boards.js";
import type { ConfigEntry } from "../../api/types/config-entries.js";
import { ConfigEntryType, PinFeature, PinMode } from "../../api/types/config-entries.js";
import { findUsedPins, sectionEndLine } from "../../util/config-entry-yaml-scan.js";
import { isPlainObject, isPrimitiveOrNullish } from "../../util/nested-values.js";
import { formatPinValue, parsePinGpio } from "../../util/pin-gpio.js";
import { expandPinModeShorthand } from "../../util/pin-mode.js";
import {
  effectiveDisabled,
  fieldKeyAttr,
  renderFieldError,
  renderLabel,
  renderStringField,
  type RenderCtx,
} from "./config-entry-renderers-shared.js";
import { renderNestedField } from "./config-entry-renderers/nested.js";
import { renderBooleanField } from "./config-entry-renderers/primitives.js";

// `parsePinGpio` / `formatPinValue` moved to `util/pin-gpio.ts` so the YAML
// used-pin scanner shares the same platform pin-format rules. Re-exported
// here to keep this module's long-standing public surface (and its tests)
// pointing at the renderer.
export { formatPinValue, parsePinGpio };

interface PinOptionView {
  optValue: string;
  primary: string;
  secondary: string;
  titleText: string;
  /** Warning icon + amber styling — for a pin in use elsewhere or input-only
   *  on an output field. A missing capability is NOT warned (a board manifest
   *  that doesn't tag the feature isn't proof the pin lacks it). */
  warn: boolean;
  /** Board-unavailable (occupied / tied to flash) — disabled + grouped under
   *  "Reserved". */
  reserved: boolean;
  /** Positively carries the field's required features and has no direction
   *  conflict — grouped under "Supports …". */
  supported: boolean;
}

function buildPinOption(
  pin: BoardPin,
  entry: ConfigEntry,
  usedPins: Map<number, string>,
  ctx: RenderCtx
): PinOptionView {
  const optValue = formatPinValue(pin.gpio, ctx.board?.esphome.platform);
  const primary = pin.label || optValue;
  const occupiedBy = pin.occupied_by || "";
  const usedBy = usedPins.get(pin.gpio) || "";
  const needsOutput =
    entry.pin_mode === PinMode.OUTPUT || entry.pin_mode === PinMode.INPUT_OUTPUT;
  const inputOnlyConflict = needsOutput && pin.features.includes(PinFeature.INPUT_ONLY);
  const hasAllFeatures = (entry.pin_features ?? []).every((f) =>
    pin.features.includes(f)
  );
  const reserved = pin.available === false;
  const inUse = !!(occupiedBy || usedBy);

  const inUseText = occupiedBy
    ? ctx.localize("device.pin_occupied_by", { name: occupiedBy })
    : usedBy
      ? ctx.localize("device.pin_used_by", { name: usedBy })
      : "";
  const conflictText = inputOnlyConflict ? ctx.localize("device.pin_input_only") : "";
  const baseSupporting =
    pin.notes || (reserved ? ctx.localize("device.pin_unavailable") : "");

  const secondaryParts: string[] = [];
  if (pin.label && pin.label !== optValue) secondaryParts.push(optValue);
  if (inUseText) secondaryParts.push(inUseText);
  if (conflictText) secondaryParts.push(conflictText);
  if (baseSupporting) secondaryParts.push(baseSupporting);

  return {
    optValue,
    primary,
    secondary: secondaryParts.join(" • "),
    titleText: [inUseText, conflictText, baseSupporting].filter(Boolean).join(" — "),
    warn: inUse || inputOnlyConflict,
    reserved,
    supported: hasAllFeatures && !inputOnlyConflict,
  };
}

/** Render the pin options in up to three sections: pins that positively carry
 *  the field's required feature(s) under "Supports …" (only when those
 *  features exist and some pin advertises them — never a quality claim on
 *  untagged pins), the rest, and board-unavailable pins (disabled) under
 *  "Reserved". A section header only appears when there's something to
 *  contrast; with nothing to split it's one flat list. */
function renderPinOptions(
  pins: BoardPin[],
  entry: ConfigEntry,
  usedPins: Map<number, string>,
  value: string,
  ctx: RenderCtx
): TemplateResult {
  const supported: PinOptionView[] = [];
  const other: PinOptionView[] = [];
  const reserved: PinOptionView[] = [];
  for (const pin of pins) {
    const view = buildPinOption(pin, entry, usedPins, ctx);
    (view.reserved ? reserved : view.supported ? supported : other).push(view);
  }
  // Only contrast supported-vs-other when both groups are non-empty; otherwise
  // it's one flat list (no false "this is special" framing).
  const splitByCapability = supported.length > 0 && other.length > 0;
  const features = (entry.pin_features ?? []).map((f) => f.toUpperCase()).join(", ");
  // The group label + divider are a sighted-only contrast cue. ``wa-select``
  // only navigates ``<wa-option>`` children, so a screen reader would
  // otherwise announce these as stray, contextless text mid-list (there's no
  // wa-optgroup to carry real grouping). Hide them from the a11y tree; each
  // option still conveys its own state (reserved → ``disabled``, in-use /
  // conflict → ``title``), so no per-option context is lost.
  const header = (key: string, withDivider: boolean) =>
    html`${withDivider
        ? html`<wa-divider class="pin-group-divider" aria-hidden="true"></wa-divider>`
        : nothing} <small class="pin-group-label" aria-hidden="true">${key}</small>`;
  return html`
    ${splitByCapability && features
      ? header(ctx.localize("device.pin_group_supports", { features }), false)
      : nothing}
    ${supported.map((v) => renderPinOption(v, value))}
    ${splitByCapability ? header(ctx.localize("device.pin_group_other"), true) : nothing}
    ${other.map((v) => renderPinOption(v, value))}
    ${reserved.length > 0
      ? header(ctx.localize("device.pin_group_reserved"), true)
      : nothing}
    ${reserved.map((v) => renderPinOption(v, value))}
  `;
}

function renderPinOption(v: PinOptionView, value: string): TemplateResult {
  return html`<wa-option
    class=${v.warn ? "pin-option pin-option--warn" : "pin-option"}
    value=${v.optValue}
    .label=${v.primary}
    ?selected=${v.optValue === value}
    ?disabled=${v.reserved}
    title=${v.titleText}
  >
    <span class="pin-option-stack">
      <span class="pin-option-primary">
        ${v.primary}
        ${v.warn
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
}

export function renderPinField(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx
): TemplateResult {
  if (!ctx.board || ctx.board.pins.length === 0) {
    return renderStringField(entry, "text", path, ctx);
  }

  // Pin presets can land as bare ints (`12`), `GPIOn` / `P0.x` strings, or
  // the long-form pin block (`{ number: N, mode: {...}, inverted: ... }`).
  // The wa-option values are the platform's value form (`GPIOn`, or `P0.x`
  // for nRF52), so normalise before comparing or the disabled select renders
  // blank.
  const rawValue = ctx.getAt(path);
  const valueGpio = parsePinGpio(rawValue);
  const platform = ctx.board.esphome.platform;
  // Fallback to ``String(rawValue)`` only when the value is a
  // primitive — js-yaml emits null-prototype maps for partial /
  // mid-edit pin blocks, and ``String(Object.create(null))`` throws
  // "Cannot convert object to primitive value", crashing the form
  // for a pin renderer that's already in a recoverable state. Treat
  // unparseable objects as "no selection" so no option matches and
  // the dropdown stays empty rather than blowing up.
  const value =
    valueGpio !== null
      ? formatPinValue(valueGpio, platform)
      : isPrimitiveOrNullish(rawValue)
        ? String(rawValue ?? "")
        : "";
  const invalid = ctx.errorAt(path) !== null;
  // Show every board pin; a pin that doesn't match the field's required
  // features (or direction) isn't hidden — it's grouped under "Other pins"
  // and stays selectable (issue #1012). Only a direction conflict
  // (input-only pin on an output field) or an in-use pin is warned; a
  // merely-missing capability is grouped, not warned. Hiding it is too
  // harsh for unusual boards and "I know what I'm doing" workflows.
  let visible = ctx.board.pins;
  // A featured-component preset can narrow the pin set further — e.g.
  // pin the ESK-1 PIR motion sensor to one of the two FPC-connector
  // GPIOs. Skip the narrowing if no parseable GPIOs survive (a manifest
  // typo shouldn't blank the dropdown — the user will see the full
  // pin set instead, with a visible error for the field).
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
    <div class="field" data-field-key=${fieldKeyAttr(path)}>
      ${renderLabel(entry, ctx)}
      <wa-select
        data-no-value-sync
        class=${invalid ? "invalid" : ""}
        ?disabled=${fieldDisabled}
        @change=${onPinChange}
      >
        ${renderPinOptions(visible, entry, usedPins, value, ctx)}
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
  // Reuse the form's ``nestedOpenSections`` machinery so the open/closed
  // state survives a re-render. Default closed (opt-in disclosure), but
  // seed open when the pin already carries long-form values (``mode`` /
  // ``inverted`` / …) so a field set in YAML isn't hidden — seeded, not
  // forced, so reading ``isOpen`` from the set honors a later user collapse.
  const pinValues = ctx.scopeValues(path);
  const hasAdvancedValue =
    isLongForm &&
    Object.keys(pinValues).some((k) => k !== "number" && pinValues[k] !== undefined);
  if (hasAdvancedValue) ctx.seedNestedOpen(advancedKey);
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
    <div
      class="pin-advanced"
      data-field-key="${advancedKey}"
      data-reveal-for="${fieldKeyAttr(path)}"
    >
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
            ${longFormFields.map((child) => renderLongFormChild(child, path, ctx))}
          </div>`
        : nothing}
    </div>
  `;
}

/** Render one long-form pin field; the ``mode`` group is scoped to the flags
 *  the pin's external provider allows (a native / unknown provider keeps all). */
function renderLongFormChild(
  child: ConfigEntry,
  path: string[],
  ctx: RenderCtx
): unknown {
  if (child.key !== "mode" || child.type !== ConfigEntryType.NESTED) {
    return ctx.renderEntry(child, [...path, child.key]);
  }
  const modePath = [...path, child.key];
  const modeValue = ctx.getAt(modePath);
  const allowed = providerAllowedModes(ctx.getAt(path), ctx.pinRegistryModes);
  // Keep any flag the value already sets visible even if the provider now
  // disallows it, so a legacy/invalid config can be repaired from the editor.
  const scoped = allowed
    ? scopeModeChildren(child, allowed, presentModeFlags(modeValue))
    : child;
  // A scalar shorthand (``mode: OUTPUT``) needs the display-expansion wrapper;
  // the object form goes through the normal nested dispatch.
  return typeof modeValue === "string"
    ? renderPinModeField(scoped, modePath, ctx)
    : ctx.renderEntry(scoped, modePath);
}

/** Allowed mode flags for *pinValue*'s provider, or ``null`` (native pin,
 *  short form, unknown provider, or empty list) to keep the full flag set. */
function providerAllowedModes(
  pinValue: unknown,
  modesMap: Record<string, string[]> | undefined
): string[] | null {
  if (!modesMap || !isPlainObject(pinValue)) return null;
  for (const key of Object.keys(pinValue)) {
    // Own-property check, not ``in``, so a key like ``toString`` can't match
    // an inherited member. An empty list means no scoping (show every flag).
    if (Object.prototype.hasOwnProperty.call(modesMap, key)) {
      const allowed = modesMap[key];
      return allowed.length > 0 ? allowed : null;
    }
  }
  return null;
}

/** Flag keys the current ``mode`` value sets (object keys, or a scalar
 *  shorthand's expansion) — kept visible so a legacy flag stays editable. */
function presentModeFlags(modeValue: unknown): string[] {
  if (typeof modeValue === "string") {
    return Object.keys(expandPinModeShorthand(modeValue) ?? {});
  }
  return isPlainObject(modeValue) ? Object.keys(modeValue) : [];
}

/** *modeEntry* with its flag children narrowed to *allowed* plus any flag
 *  *present* already sets, so a disallowed-but-set flag stays editable. */
function scopeModeChildren(
  modeEntry: ConfigEntry,
  allowed: string[],
  present: string[]
): ConfigEntry {
  const keep = new Set([...allowed, ...present]);
  const children = (modeEntry.config_entries ?? []).filter((c) => keep.has(c.key));
  return { ...modeEntry, config_entries: children };
}

/**
 * Render the pin ``mode`` group. A scalar shorthand (``mode: OUTPUT``)
 * is expanded to its flag dict for display so the existing checkboxes
 * reflect it; the YAML scalar is kept until the user toggles a flag,
 * which writes the flag-object form. Object form and unrecognised
 * shorthands fall through to the normal nested renderer.
 */
function renderPinModeField(
  entry: ConfigEntry,
  modePath: string[],
  ctx: RenderCtx
): unknown {
  const raw = ctx.getAt(modePath);
  const expanded = typeof raw === "string" ? expandPinModeShorthand(raw) : null;
  if (!expanded) return renderNestedField(entry, modePath, ctx);
  return renderNestedField(entry, modePath, pinModeDisplayCtx(ctx, modePath, expanded));
}

/** Wrap *ctx* so reads under *modePath* see *expanded* (a flag dict from a
 *  scalar shorthand) and a flag-child write promotes the mode to the
 *  flag-object form, replacing the scalar only on edit. */
function pinModeDisplayCtx(
  ctx: RenderCtx,
  modePath: string[],
  expanded: Record<string, boolean>
): RenderCtx {
  const modeKey = modePath.join(".");
  const flagOf = (path: string[]): string | null =>
    path.length === modePath.length + 1 &&
    path.slice(0, modePath.length).join(".") === modeKey
      ? path[modePath.length]
      : null;
  const wrapped: RenderCtx = {
    ...ctx,
    getAt: (path) => {
      if (path.join(".") === modeKey) return expanded;
      const flag = flagOf(path);
      return flag !== null ? expanded[flag] : ctx.getAt(path);
    },
    scopeValues: (path) =>
      path.join(".") === modeKey ? { ...expanded } : ctx.scopeValues(path),
    emitChange: (path, value) => {
      const flag = flagOf(path);
      if (flag === null) {
        ctx.emitChange(path, value);
        return;
      }
      const next = { ...expanded };
      if (value) next[flag] = true;
      else delete next[flag];
      ctx.emitChange(modePath, next);
    },
  };
  // The mode children are booleans; render them through the wrapper so the
  // checkboxes read/write the expanded flags.
  wrapped.renderEntry = (child, path) =>
    child.type === ConfigEntryType.BOOLEAN
      ? renderBooleanField(child, path, wrapped)
      : ctx.renderEntry(child, path);
  return wrapped;
}
