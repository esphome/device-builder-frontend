/**
 * Pin selector renderer. Lifted out of `config-entry-renderers.ts`
 * because pin rendering carries its own per-option metadata
 * computation (in-use detection, input-only conflicts, supporting
 * text) that's heavier than every other field type.
 */

import { html, nothing, type TemplateResult } from "lit";
import type { BoardPin } from "../../../api/types/boards.js";
import type { ConfigEntry } from "../../../api/types/config-entries.js";
import { PinFeature, PinMode } from "../../../api/types/config-entries.js";
import { findUsedPins, sectionEndLine } from "../../../util/config-entry-yaml-scan.js";
import { isPlainObject, isPrimitiveOrNullish } from "../../../util/nested-values.js";
import {
  formatPinValue,
  isExpanderPinValue,
  parseBoardGpio,
  parsePinGpio,
  providerKeyOf,
} from "../../../util/pin/gpio.js";
import {
  isSubstitutionString,
  resolveSubstitutions,
} from "../../../util/substitutions.js";
import { renderPinWiring } from "./wiring.js";
import {
  effectiveDisabled,
  fieldKeyAttr,
  renderFieldError,
  renderLabel,
  renderStringField,
  renderSubstitutionHint,
  type RenderCtx,
} from "../config-entry-renderers-shared.js";

// `parsePinGpio` / `formatPinValue` moved to `util/pin/gpio.ts` so the YAML
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
  /** Board-unavailable (occupied / tied to flash) — grouped under "Reserved". */
  reserved: boolean;
  /** Non-selectable. A reserved pin is disabled *except* when it's locked to
   *  the component being edited (ethernet RMII pins under ``ethernet:``) or is
   *  the field's current value, where it's still grouped under "Reserved" but
   *  stays pickable so its value renders. */
  disabled: boolean;
  /** Positively carries the field's required features and has no direction
   *  conflict — grouped under "Supports …". */
  supported: boolean;
}

/** Resolve a pin value that names a pin by alias (ESP8266 ``RX``, ``D1``)
 *  to its GPIO, so the option still selects when the value isn't a
 *  ``GPIOn`` form ``parsePinGpio`` recognises. Reads the bare string or a
 *  long-form block's ``number``; matches the catalog's per-pin ``aliases``
 *  case-insensitively. ``null`` when nothing matches. */
function gpioFromAlias(rawValue: unknown, pins: BoardPin[]): number | null {
  const name =
    typeof rawValue === "string"
      ? rawValue.trim()
      : isPlainObject(rawValue) && typeof rawValue.number === "string"
        ? rawValue.number.trim()
        : "";
  if (!name) return null;
  const lower = name.toLowerCase();
  const match = pins.find((p) => p.aliases?.some((a) => a.toLowerCase() === lower));
  return match ? match.gpio : null;
}

/** Board GPIO of *value* in any accepted spelling: the parseable forms
 *  first, then the board's alias table ("SDA", "RX", "D1"). */
function boardGpioOf(value: unknown, pins: BoardPin[]): number | null {
  return parseBoardGpio(value) ?? gpioFromAlias(value, pins);
}

/** The board's designated pins for this section's field, in one pass over
 *  ``featured_components`` (entries keyed by ``component_id``):
 *
 *  - ``lockedGpios`` — GPIOs locked to *this* component, which must stay
 *    selectable in the picker even when board-reserved (ethernet RMII
 *    pins under ``ethernet:``); flash/PSRAM pins and other components'
 *    locks remain disabled.
 *  - ``gpios`` — the wider board-defined set (locked plus field presets
 *    keyed by *entryKey*, like the RGB header pin a board pre-fills
 *    without locking); a current value here gets the wiring guard.
 *  - ``tokens`` — expander-channel ``provider:hub:channel`` identities,
 *    the non-GPIO half of the same guard. */
function boardPinsForSection(
  ctx: RenderCtx,
  entryKey: string
): { lockedGpios: Set<number>; gpios: Set<number>; tokens: Set<string> } {
  const lockedGpios = new Set<number>();
  const gpios = new Set<number>();
  const tokens = new Set<string>();
  for (const fc of ctx.board?.featured_components ?? []) {
    if (fc.component_id !== ctx.sectionKey) continue;
    for (const [key, pin] of Object.entries(fc.locked_pins ?? {})) {
      // ``lockedGpios`` (picker selectability) stays component-wide; the
      // guard sets are per-field, so a sibling field's locked GPIO
      // (ethernet's clk vs miso) doesn't read-only this field's wiring.
      if (typeof pin === "number") {
        lockedGpios.add(pin);
        if (key === entryKey) gpios.add(pin);
      } else if (typeof pin === "string" && key === entryKey) {
        tokens.add(pin);
      }
    }
    const preset = fc.fields?.[entryKey]?.value;
    if (preset == null) continue;
    // ``parsePinGpio`` so an object-form expander preset
    // (``{pcf8574: hub, number: 0}``) yields its channel token instead
    // of being dropped; an alias-spelled preset ("SDA") resolves through
    // the board's alias table; any other manifest string passes through
    // as a token.
    const id = parsePinGpio(preset) ?? gpioFromAlias(preset, ctx.board?.pins ?? []);
    if (typeof id === "number") gpios.add(id);
    else if (typeof id === "string") tokens.add(id);
    else if (typeof preset === "string") tokens.add(preset);
    else {
      // Fail closed on an unparseable object preset: a provider+hub
      // with an unreadable channel guards every channel on that hub
      // (matched by ``designationMatches``'s hub wildcard).
      const provider = providerKeyOf(preset);
      const hub =
        provider !== undefined
          ? (preset as Record<string, unknown>)[provider]
          : undefined;
      if (provider !== undefined && typeof hub === "string" && hub !== "") {
        tokens.add(`${provider}:${hub}:*`);
      }
    }
  }
  return { lockedGpios, gpios, tokens };
}

/** Whether an expander-channel *identity* matches a designation token —
 *  exact, or the hub-wildcard (``provider:hub:*``) recorded for an
 *  unparseable manifest preset. */
function designationMatches(tokens: Set<string>, identity: string): boolean {
  return (
    tokens.has(identity) ||
    tokens.has(`${identity.slice(0, identity.lastIndexOf(":") + 1)}*`)
  );
}

function buildPinOption(
  pin: BoardPin,
  entry: ConfigEntry,
  usedPins: Map<number | string, string>,
  ownLockedGpios: Set<number>,
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
  // A reserved pin locked to the component being edited stays selectable — the
  // ethernet RMII pins are reserved precisely *for* ethernet, so the user must
  // be able to keep/re-pick them while editing ``ethernet:``.
  const disabled = reserved && !ownLockedGpios.has(pin.gpio);
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
    disabled,
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
  usedPins: Map<number | string, string>,
  ownLockedGpios: Set<number>,
  value: string,
  ctx: RenderCtx
): TemplateResult {
  const supported: PinOptionView[] = [];
  const other: PinOptionView[] = [];
  const reserved: PinOptionView[] = [];
  for (const pin of pins) {
    const view = buildPinOption(pin, entry, usedPins, ownLockedGpios, ctx);
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
    html`${
        withDivider
          ? html`<wa-divider class="pin-group-divider" aria-hidden="true"></wa-divider>`
          : nothing
      } <small class="pin-group-label" aria-hidden="true">${key}</small>`;
  return html`
    ${
      splitByCapability && features
        ? header(ctx.localize("device.pin_group_supports", { features }), false)
        : nothing
    }
    ${supported.map((v) => renderPinOption(v, value))}
    ${splitByCapability ? header(ctx.localize("device.pin_group_other"), true) : nothing}
    ${other.map((v) => renderPinOption(v, value))}
    ${
      reserved.length > 0
        ? header(ctx.localize("device.pin_group_reserved"), true)
        : nothing
    }
    ${reserved.map((v) => renderPinOption(v, value))}
  `;
}

function renderPinOption(v: PinOptionView, value: string): TemplateResult {
  return html`<wa-option
    class=${v.warn ? "pin-option pin-option--warn" : "pin-option"}
    value=${v.optValue}
    .label=${v.primary}
    ?selected=${v.optValue === value}
    ?disabled=${v.disabled}
    title=${v.titleText}
  >
    <span class="pin-option-stack">
      <span class="pin-option-primary">
        ${v.primary}
        ${
          v.warn
            ? html`<wa-icon
                class="pin-warn-icon"
                library="mdi"
                name="alert-circle-outline"
              ></wa-icon>`
            : nothing
        }
      </span>
      ${
        v.secondary
          ? html`<span class="pin-option-secondary">${v.secondary}</span>`
          : nothing
      }
    </span>
  </wa-option>`;
}

export function renderPinField(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx
): TemplateResult {
  const rawValue = ctx.getAt(path);
  // A long-form pin whose ``number`` is a ``${var}`` reference can't drive
  // the board-GPIO picker — no option matches, so the select rendered blank
  // (#2268) — and a pick would clobber the reference with a literal. Edit
  // ``number`` as text with the resolves-to hint, mirroring the scalar
  // ${var} gate in ``config-entry-form``. Checked before the boardless
  // fallback, which would bail an object value to the YAML-only shell.
  if (isPlainObject(rawValue) && isSubstitutionString(rawValue.number)) {
    return renderSubstitutionPin(entry, path, ctx, rawValue, rawValue.number);
  }
  if (!ctx.board || ctx.board.pins.length === 0) {
    return renderStringField(entry, "text", path, ctx);
  }

  // Pin presets can land as bare ints (`12`), `GPIOn` / `P0.x` strings, or
  // the long-form pin block (`{ number: N, mode: {...}, inverted: ... }`).
  // The wa-option values are the platform's value form (`GPIOn`, or `P0.x`
  // for nRF52), so normalise before comparing or the disabled select renders
  // blank.
  const identity = parsePinGpio(rawValue);
  if (typeof identity === "string") {
    // An I/O-expander pin is a `provider:hub:channel` channel, never a board
    // GPIO, so the board-GPIO picker can't represent it regardless of disabled
    // state — show the channel read-only. Gating this on disabled would let an
    // editable expander pin fall through to the board picker, where a selection
    // writes a board GPIO into `pin.number` and clobbers the channel. The
    // Advanced mode-flag disclosure still renders below (the channel's mode is
    // editable, scoped to the provider), just not the board-GPIO selector.
    // Board designations via ``suggestions`` count too (fail closed): a
    // suggestion that isn't a board GPIO is an expander token candidate.
    const suggestedTokens = (entry.suggestions ?? []).some(
      (sug) => typeof sug === "string" && parseBoardGpio(sug) === null && sug === identity
    );
    return renderExpanderPin(
      entry,
      path,
      ctx,
      identity,
      rawValue,
      suggestedTokens ||
        designationMatches(boardPinsForSection(ctx, entry.key).tokens, identity)
    );
  }
  // Fall back to alias resolution (`RX` → GPIO3) when the value isn't a
  // `GPIOn` form; this drives both the selected option and the re-add of a
  // filtered-out active pin below. An expander token isn't a board GPIO.
  const valueGpio =
    (typeof identity === "number" ? identity : null) ??
    gpioFromAlias(rawValue, ctx.board.pins);
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
  // When the field is unset, grey the schema default in the box (parity with
  // the select renderer). A default named by alias (i2c ``sda: SDA``) resolves
  // to its GPIO so the box shows the real pin label rather than the raw name.
  const defaultGpio =
    entry.default_value != null ? boardGpioOf(entry.default_value, ctx.board.pins) : null;
  const defaultPlaceholder =
    defaultGpio !== null
      ? (ctx.board.pins.find((p) => p.gpio === defaultGpio)?.label ??
        formatPinValue(defaultGpio, platform))
      : "";
  // Show every board pin; a pin that doesn't match the field's required
  // features (or direction) isn't hidden — it's grouped under "Other pins"
  // and stays selectable (issue #1012). Only a direction conflict
  // (input-only pin on an output field) or an in-use pin is warned; a
  // merely-missing capability is grouped, not warned. Hiding it is too
  // harsh for unusual boards and "I know what I'm doing" workflows.
  let visible = ctx.board.pins;
  const boardPin =
    valueGpio !== null
      ? (ctx.board.pins.find((p) => p.gpio === valueGpio) ?? null)
      : null;
  const suggestionGpios = new Set(
    (entry.suggestions ?? [])
      .map((s) => boardGpioOf(s, ctx.board!.pins))
      .filter((g): g is number => g !== null)
  );
  // A featured-component preset can narrow the pin set further — e.g.
  // pin the ESK-1 PIR motion sensor to one of the two FPC-connector
  // GPIOs. Skip the narrowing if no parseable GPIOs survive (a manifest
  // typo shouldn't blank the dropdown — the user will see the full
  // pin set instead, with a visible error for the field).
  if (suggestionGpios.size > 0) {
    const narrowed = visible.filter((p) => suggestionGpios.has(p.gpio));
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
  // The board's preset pin trumps generic feature filtering — a locked
  // GPIO12 (Sonoff relay) doesn't necessarily declare the same features
  // the underlying `switch.gpio` schema asks for, but the manifest is
  // authoritative. Make sure the active value's pin is always in the
  // dropdown so the disabled select still shows the right option.
  if (boardPin && !visible.some((p) => p.gpio === boardPin.gpio)) {
    visible = [boardPin, ...visible];
  }
  const usedPins = findUsedPins(
    ctx.yaml,
    ctx.fromLine,
    sectionEndLine(ctx.yaml, ctx.fromLine)
  );
  const boardPins = boardPinsForSection(ctx, entry.key);
  const ownLockedGpios = boardPins.lockedGpios;
  // The current pin sitting on a board-defined GPIO for this section
  // (locked, field preset, or suggestion) means the wiring is the
  // board's, not the user's — the wiring UI guards its edits behind an
  // unlock. Value-dependent on purpose: a pin moved off the board's
  // designation is the user's own.
  const boardPresetPin =
    valueGpio !== null &&
    (boardPins.gpios.has(valueGpio) || suggestionGpios.has(valueGpio));
  // The field's current value must stay pickable even on a reserved pin the
  // board didn't lock to this section (a hand-edited YAML, or a manifest
  // preset missing its lock) — a disabled selected option blanks the
  // wa-select head, hiding the real config value.
  if (valueGpio !== null) {
    ownLockedGpios.add(valueGpio);
  }
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
      <!-- Keyed as the long form's number so the YAML cursor lands on the
           select itself (the whole-field fallback centers mid-panel once
           the wiring disclosure is open). Short form keeps the bare path:
           a number key would break the form-to-YAML pulse, which looks up
           a number line the YAML doesn't have. -->
      <wa-select
        data-no-value-sync
        data-field-key=${fieldKeyAttr(isLongForm ? [...path, "number"] : path)}
        class=${invalid ? "invalid" : ""}
        placeholder=${defaultPlaceholder}
        ?disabled=${fieldDisabled}
        @change=${onPinChange}
      >
        ${renderPinOptions(visible, entry, usedPins, ownLockedGpios, value, ctx)}
      </wa-select>
      ${renderFieldError(path, ctx)}
      ${renderPinWiring({
        entry,
        path,
        ctx,
        rawValue,
        boardPin,
        boardPreset: boardPresetPin,
      })}
    </div>
  `;
}

/** Long-form pin with a ``${var}`` ``number``: a text input for the
 *  reference (edits route to ``path.number``, so mode / inverted are
 *  preserved) plus the Advanced disclosure the normal path renders. */
function renderSubstitutionPin(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx,
  rawValue: Record<string, unknown>,
  number: string
): TemplateResult {
  const numberPath = [...path, "number"];
  const invalid = ctx.errorAt(numberPath) !== null;
  const fieldDisabled = effectiveDisabled(entry, ctx);
  // The ``${var}`` can still resolve to the board's designation for this
  // section — run the picker path's test on the resolved value, so
  // spelling the pin as a substitution doesn't drop the wiring guard.
  // Re-parsing the whole value keeps the provider rule: an expander pin
  // yields its channel token (compared against the board's token
  // designations), never a board GPIO its channel number could alias. A
  // plain pin's alias spelling ("SDA") resolves through the board table.
  // An unresolvable reference guards nothing (the wiring is unknowable,
  // and the presets gate already withholds cards).
  const pins = ctx.board?.pins ?? [];
  const resolvedNumber = resolveSubstitutions(number, ctx.substitutions);
  const resolved =
    parsePinGpio({ ...rawValue, number: resolvedNumber }) ??
    (isExpanderPinValue(rawValue) ? null : gpioFromAlias(resolvedNumber, pins));
  const boardPins = boardPinsForSection(ctx, entry.key);
  const boardPreset =
    resolved !== null &&
    (typeof resolved === "number"
      ? boardPins.gpios.has(resolved) ||
        (entry.suggestions ?? []).some((s) => boardGpioOf(s, pins) === resolved)
      : designationMatches(boardPins.tokens, resolved) ||
        (entry.suggestions ?? []).some((s) => s === resolved));
  return html`
    <div class="field" data-field-key=${fieldKeyAttr(path)}>
      ${renderLabel(entry, ctx)}
      <input
        type="text"
        autocomplete="off"
        class=${invalid ? "invalid" : ""}
        .value=${number}
        ?disabled=${fieldDisabled}
        @input=${(e: Event) =>
          ctx.emitChange(numberPath, (e.target as HTMLInputElement).value)}
      />
      ${renderSubstitutionHint(number, ctx.substitutions, ctx.localize)}
      ${renderFieldError(numberPath, ctx)}
      ${renderPinWiring({
        entry,
        path,
        ctx,
        rawValue,
        boardPin: null,
        boardPreset,
      })}
    </div>
  `;
}

/**
 * Render an I/O-expander pin: the `provider:hub:channel` channel shown read-only
 * (an expander channel isn't a board GPIO, so the board-pin picker can't
 * represent it) plus the Advanced mode-flag disclosure — the channel's mode is
 * still editable, scoped to the provider.
 */
function renderExpanderPin(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx,
  identity: string,
  rawValue: unknown,
  boardPreset: boolean
): TemplateResult {
  const [provider, hub, channel] = identity.split(":");
  return html`
    <div class="field" data-field-key=${fieldKeyAttr(path)}>
      ${renderLabel(entry, ctx)}
      <input
        type="text"
        readonly
        .value=${ctx.localize("device.pin_on_expander", { provider, hub, channel })}
      />
      ${renderFieldError(path, ctx)}
      ${renderPinWiring({
        entry,
        path,
        ctx,
        rawValue,
        boardPin: null,
        boardPreset,
      })}
    </div>
  `;
}
