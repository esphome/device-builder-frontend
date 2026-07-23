/**
 * The pin field's wiring section: the long-form pin fields (``mode``
 * flag group + ``inverted``) behind a summary disclosure, fronted by
 * guided wiring presets ("button or switch to ground", "active low
 * output", …) on fields that declare a direction via ``pin_mode``.
 * Split from ``config-entry-pin-renderer.ts`` so the GPIO picker and
 * the wiring UI stay separately readable.
 */

import { mdiTune } from "@mdi/js";
import { html, nothing, type TemplateResult } from "lit";
import type { BoardPin } from "../../api/types/boards.js";
import type { ConfigEntry } from "../../api/types/config-entries.js";
import { ConfigEntryType } from "../../api/types/config-entries.js";
import { withBase } from "../../util/base-path.js";
import { isPlainObject } from "../../util/nested-values.js";
import { expandPinModeShorthand } from "../../util/pin-mode.js";
import {
  applyPresetToPin,
  KNOWN_MODE_FLAGS,
  modeFlagsOf,
  presetsForPinMode,
  presetUnavailableReason,
  wiringStateOf,
  wiringTechSummary,
  type WiringPreset,
  type WiringState,
} from "../../util/pin-wiring-presets.js";
import { parseYamlBoolean } from "../../util/yaml-serialize.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { looksLikeSubstitution } from "../../util/substitutions.js";
import { onChoiceGroupKeydown, rovingTabbable } from "../shared/choice-group.js";
import { renderDisclosure } from "../shared/disclosure.js";
import {
  fieldKeyAttr,
  filterChildEntries,
  type RenderCtx,
} from "./config-entry-renderers-shared.js";
import { renderNestedField } from "./config-entry-renderers/nested.js";
import { renderBooleanField } from "./config-entry-renderers/primitives.js";

registerMdiIcons({ tune: mdiTune });

export interface PinWiringOptions {
  entry: ConfigEntry;
  path: string[];
  ctx: RenderCtx;
  rawValue: unknown;
  isLongForm: boolean;
  fieldDisabled: boolean;
  boardPin: BoardPin | null;
  /** The pin sits on a GPIO the board locks to this section — the wiring
   *  is the board's, so edits are guarded behind an unlock. */
  boardPreset: boolean;
}

/**
 * Render the wiring disclosure carrying the long-form pin fields
 * (``mode`` flag group + ``inverted``) attached by
 * ``script/sync_components.py``'s ``_pin_long_form_extras``
 * (esphome/device-builder#430). ESPHome accepts both forms:
 *
 *     pin: GPIO5          # short form — what the picker writes
 *     pin:                # long form — what any wiring edit promotes to
 *       number: GPIO5
 *       mode:
 *         pullup: true
 *       inverted: false
 *
 * Fields that declare a direction (``pin_mode`` input/output) get the
 * preset cards; everything else (expander channels, ``${var}`` modes,
 * directionless pins) keeps the raw flag disclosure.
 *
 * Returns ``nothing`` when the entry has no nested config_entries —
 * bus pins (uart/i2c/adc) and pre-#430 catalogs keep the plain picker.
 */
export function renderPinWiring(opts: PinWiringOptions): TemplateResult | typeof nothing {
  const { entry, path, ctx, rawValue, isLongForm, fieldDisabled, boardPin } = opts;
  // Force-include advanced children: how a button or relay is wired is
  // not an advanced nicety, so the section must not hide behind the
  // global Show-advanced toggle. Platform / depends_on gating still
  // applies through the shared filter.
  const pinValues = ctx.scopeValues(path);
  const longFormFields = filterChildEntries(entry.config_entries ?? [], pinValues, ctx, {
    includeAdvanced: true,
  });
  if (longFormFields.length === 0) return nothing;

  const hasAdvancedValue =
    isLongForm &&
    Object.keys(pinValues).some((k) => k !== "number" && pinValues[k] !== undefined);
  // A hard-locked pin is fully board-owned; add zero chrome unless the
  // YAML already carries wiring values worth surfacing.
  if (entry.locked && !hasAdvancedValue) return nothing;

  const modeChild = longFormFields.find(
    (c) => c.key === "mode" && c.type === ConfigEntryType.NESTED
  );
  const modeValue = isLongForm ? (rawValue as Record<string, unknown>).mode : undefined;
  const invertedValue = isLongForm
    ? (rawValue as Record<string, unknown>).inverted
    : undefined;
  // Preset cards only on generic-GPIO platforms: on a bus or data-line
  // pin (uart, an addressable LED strip) the wiring is the protocol's,
  // not the user's circuit, so cards like "active low output" mislead.
  const presets =
    modeChild &&
    ctx.sectionKey.endsWith(".gpio") &&
    providerAllowedModes(rawValue, ctx.pinRegistryModes) === null &&
    !(typeof modeValue === "string" && looksLikeSubstitution(modeValue))
      ? presetsForPinMode(entry.pin_mode)
      : [];
  const usePresets = presets.length > 0;

  // A board-preset pin (locked GPIO for this section, or a featured
  // preset narrowing) carries the board's known-good wiring; edits are
  // view-only until the user flips the unlock. Session-transient, so the
  // guard re-arms on reload.
  const guardKey = `${path.join(".")}:pin-guard`;
  const boardPreset = opts.boardPreset || (entry.suggestions ?? []).length > 0;
  const guarded =
    boardPreset && !fieldDisabled && ctx.getClusterChoice(guardKey) !== "unlocked";

  let state: WiringState = { kind: "default" };
  let labelText: string | undefined;
  if (usePresets) {
    state = wiringStateOf(presets, modeValue, invertedValue, entry.pin_mode);
    // An implicit match (no stored flags) summarizes as the platform
    // default, not as an explicit choice the user never made.
    const implicitPreset =
      state.kind === "preset" && state.implicit === true ? state.preset : null;
    const summaryValue =
      state.kind === "preset" && !implicitPreset
        ? ctx.localize(`device.pin_wiring_${state.preset.id}`)
        : ctx.localize(
            state.kind === "custom"
              ? "device.pin_wiring_custom"
              : "device.pin_wiring_default"
          );
    // The effective flags in technical vocabulary, so advanced users can
    // read what the pin is set to without opening the section.
    const currentTech = implicitPreset
      ? wiringTechSummary(implicitPreset.flags, false)
      : wiringTechSummary(
          modeFlagsOf(modeValue) ?? {},
          parseYamlBoolean(invertedValue) === true
        );
    labelText = currentTech
      ? ctx.localize("device.pin_wiring_summary_with_tech", {
          value: summaryValue,
          tech: currentTech,
        })
      : ctx.localize("device.pin_wiring_summary", { value: summaryValue });
  }

  const advancedKey = `${path.join(".")}:pin-advanced`;
  // Seed open only when the summary line can't carry the state: raw
  // disclosure fields with values, or a flag combination no preset
  // names. A preset-matched pin stays collapsed — the summary announces
  // it, which keeps preconfigured boards quiet.
  if (hasAdvancedValue && (!usePresets || state.kind === "custom")) {
    ctx.seedNestedOpen(advancedKey);
  }
  const isOpen = ctx.nestedOpenSections.has(advancedKey);

  const onToggle = () => {
    // Locked / disabled fields must not mutate via the disclosure —
    // without this guard, opening it on a short-form locked pin would
    // fire the promotion ``emitChange`` and rewrite the locked value to
    // the long form. The toggle is also rendered ``disabled`` below, but
    // defending in both places means a synthetic click event can't
    // bypass the guard.
    if (fieldDisabled) return;
    ctx.toggleNested(advancedKey);
    // When opening for the first time on a short-form pin value, promote
    // ``pin: GPIO5`` → ``pin: { number: GPIO5 }`` so a subsequent wiring
    // edit can write to ``pin.mode`` without ``setIn`` clobbering the
    // GPIO. Skip when already long-form (preserves the user's existing
    // flags), when the pin has no value yet, or while the board-preset
    // guard is armed — merely viewing a guarded pin must not edit YAML
    // (the unlock performs the promotion instead).
    if (!isOpen && !isLongForm && !guarded && rawValue != null && rawValue !== "") {
      ctx.emitChange(path, { number: rawValue });
    }
  };

  const onGuardToggle = (e: Event) => {
    const on = (e.target as HTMLInputElement & { checked: boolean }).checked;
    ctx.setClusterChoice(guardKey, on ? "unlocked" : "locked");
    if (on && !isLongForm && rawValue != null && rawValue !== "") {
      ctx.emitChange(path, { number: rawValue });
    }
  };
  const guardRow =
    boardPreset && !fieldDisabled
      ? html`<div class="pin-wiring-guard">
          <wa-icon library="mdi" name="lock-outline"></wa-icon>
          <div class="pin-wiring-guard-text">
            <span class="field-label">${ctx.localize("device.pin_wiring_guard")}</span>
            <p class="field-description">
              ${ctx.localize("device.pin_wiring_guard_hint")}
            </p>
          </div>
          <wa-switch
            ?checked=${!guarded}
            aria-label=${ctx.localize("device.pin_wiring_guard_unlock")}
            @change=${onGuardToggle}
          ></wa-switch>
        </div>`
      : nothing;
  // While guarded, everything inside the panel renders read-only; the
  // ctx copy flips the shared ``effectiveDisabled`` for child renderers.
  const panelCtx = guarded ? { ...ctx, disabled: true } : ctx;
  const editDisabled = fieldDisabled || guarded;

  return html`
    <div
      class="pin-advanced"
      data-field-key="${advancedKey}"
      data-reveal-for="${fieldKeyAttr(path)}"
    >
      ${renderDisclosure({
        open: isOpen,
        onToggle,
        localize: ctx.localize,
        labelKey: "device.pin_advanced",
        labelText,
        variant: "quiet",
        iconBefore: true,
        disabled: fieldDisabled,
        body: () =>
          usePresets
            ? html`${guardRow}
              ${renderWiringPanel({
                longFormFields,
                modeChild: modeChild!,
                modeValue,
                path,
                ctx: panelCtx,
                rawValue,
                presets,
                state,
                boardPin,
                editDisabled,
              })}`
            : html`${guardRow}
              ${longFormFields.map((child) => renderLongFormChild(child, path, panelCtx))}`,
      })}
    </div>
  `;
}

interface WiringPanelOptions {
  longFormFields: ConfigEntry[];
  modeChild: ConfigEntry;
  modeValue: unknown;
  path: string[];
  ctx: RenderCtx;
  rawValue: unknown;
  presets: WiringPreset[];
  state: WiringState;
  boardPin: BoardPin | null;
  editDisabled: boolean;
}

function renderWiringPanel(opts: WiringPanelOptions): TemplateResult {
  const { longFormFields, modeValue, path, ctx, presets, state, boardPin } = opts;
  const editDisabled = opts.editDisabled;
  const choiceKey = `${path.join(".")}:pin-wiring`;
  const showCustom =
    ctx.getClusterChoice(choiceKey) === "custom" || state.kind === "custom";

  const pickPreset = (preset: WiringPreset) => {
    if (editDisabled) return;
    // Clear a prior Custom pick; the preset itself round-trips from the
    // written flags, so no id needs storing.
    ctx.setClusterChoice(choiceKey, "");
    ctx.emitChange(path, applyPresetToPin(preset, opts.rawValue));
  };
  const pickCustom = () => {
    if (editDisabled) return;
    ctx.setClusterChoice(choiceKey, "custom");
  };

  const reasons = presets.map((p) => presetUnavailableReason(p, boardPin));
  // A non-null reason implies boardPin (presetUnavailableReason returns
  // null without one), so one localized string covers every muted card.
  const unavailableText = reasons.some((r) => r !== null)
    ? ctx.localize("device.pin_wiring_unavailable_input_only", {
        pin: boardPin!.label,
      })
    : "";
  const banner = unavailableText
    ? html`<div class="warning-banner pin-wiring-banner">
        ${ctx.localize("device.pin_wiring_input_only_banner", {
          pin: boardPin!.label,
        })}
      </div>`
    : nothing;

  const invertedChild = longFormFields.find((c) => c.key === "inverted");
  const others = longFormFields.filter((c) => c.key !== "mode" && c.key !== "inverted");

  const selectedId = showCustom
    ? "custom"
    : state.kind === "preset"
      ? state.preset.id
      : null;
  return html`
    ${banner}
    <div
      class="pin-wiring-grid"
      role="radiogroup"
      aria-label=${ctx.localize("device.pin_wiring_group_label")}
      @keydown=${onChoiceGroupKeydown}
    >
      ${presets.map((preset, i) =>
        renderPresetCard(
          preset,
          selectedId === preset.id,
          rovingTabbable(selectedId === preset.id, selectedId !== null, i),
          reasons[i] ? unavailableText : "",
          editDisabled,
          () => pickPreset(preset),
          ctx
        )
      )}
      <button
        type="button"
        class="pin-wiring-card${showCustom ? " pin-wiring-card--selected" : ""}"
        data-preset=${
          // A binding (not a static attribute) so the template-walker
          // tests can look the card up alongside the preset cards.
          "custom"
        }
        role="radio"
        aria-checked=${showCustom ? "true" : "false"}
        tabindex=${
          rovingTabbable(showCustom, selectedId !== null, presets.length) ? "0" : "-1"
        }
        ?disabled=${editDisabled}
        @click=${pickCustom}
      >
        <span class="pin-wiring-diagram pin-wiring-diagram--icon" aria-hidden="true">
          <wa-icon library="mdi" name="tune"></wa-icon>
        </span>
        <span class="pin-wiring-card-title">
          ${ctx.localize("device.pin_wiring_custom")}
        </span>
        <span class="pin-wiring-card-desc">
          ${ctx.localize("device.pin_wiring_custom_description")}
        </span>
      </button>
    </div>
    ${
      showCustom
        ? renderCustomEditor(
            opts.modeChild,
            invertedChild,
            path,
            ctx,
            modeValue,
            editDisabled
          )
        : nothing
    }
    ${others.map((child) => renderLongFormChild(child, path, ctx))}
  `;
}

/** Decorative micro-schematic for a preset card or custom-editor row,
 *  from the bundled ``assets/pin-wiring/<name>.svg`` files. Applied as a
 *  CSS mask so the drawing takes the theme's text color in both modes. */
function wiringDiagram(name: string): TemplateResult {
  const url = withBase(`/assets/pin-wiring/${name}.svg`);
  return html`<span
    class="pin-wiring-diagram pin-wiring-diagram--mask"
    style="-webkit-mask-image: url('${url}'); mask-image: url('${url}')"
    aria-hidden="true"
  ></span>`;
}

function renderPresetCard(
  preset: WiringPreset,
  selected: boolean,
  tabbable: boolean,
  reasonText: string,
  editDisabled: boolean,
  onPick: () => void,
  ctx: RenderCtx
): TemplateResult {
  const classes = [
    "pin-wiring-card",
    selected ? "pin-wiring-card--selected" : "",
    reasonText ? "pin-wiring-card--unavailable" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return html`<button
    type="button"
    class=${classes}
    data-preset=${preset.id}
    role="radio"
    aria-checked=${selected ? "true" : "false"}
    tabindex=${tabbable ? "0" : "-1"}
    ?disabled=${editDisabled || !!reasonText}
    @click=${onPick}
  >
    ${wiringDiagram(preset.id)}
    <span class="pin-wiring-card-title">
      ${ctx.localize(`device.pin_wiring_${preset.id}`)}
      ${
        preset.recommended && !reasonText
          ? html`<span class="pin-wiring-badge">
              ${ctx.localize("device.pin_wiring_recommended")}
            </span>`
          : nothing
      }
    </span>
    <span
      class="pin-wiring-card-desc${reasonText ? " pin-wiring-card-desc--reason" : ""}"
    >
      ${reasonText || ctx.localize(`device.pin_wiring_${preset.id}_description`)}
    </span>
    <code class="pin-wiring-card-tech">
      ${wiringTechSummary(preset.flags, preset.invertedWrite === true)}
    </code>
  </button>`;
}

/**
 * The Custom pane: direction and pull resistor as exclusive choices
 * (so ``pullup`` + ``pulldown`` together is unrepresentable from the
 * UI), open drain, and the catalog's ``inverted`` field. A mode value
 * carrying flags outside the native set (``analog``, expander flags)
 * falls back to the raw flag list so nothing becomes uneditable.
 */
function renderCustomEditor(
  modeChild: ConfigEntry,
  invertedChild: ConfigEntry | undefined,
  path: string[],
  ctx: RenderCtx,
  modeValue: unknown,
  fieldDisabled: boolean
): TemplateResult {
  const flags = modeFlagsOf(modeValue);
  if (flags === null || Object.keys(flags).some((k) => !KNOWN_MODE_FLAGS.has(k))) {
    return html`<div class="pin-wiring-custom">
      ${renderLongFormChild(modeChild, path, ctx)}
      ${invertedChild ? renderLongFormChild(invertedChild, path, ctx) : nothing}
    </div>`;
  }

  const direction =
    flags.input && flags.output
      ? "both"
      : flags.output
        ? "output"
        : flags.input
          ? "input"
          : "";
  const pull = flags.pullup ? "pullup" : flags.pulldown ? "pulldown" : "none";
  const writeMode = (mutate: (f: Record<string, boolean>) => void) => {
    const next = { ...flags };
    mutate(next);
    for (const key of Object.keys(next)) {
      if (!next[key]) delete next[key];
    }
    ctx.emitChange([...path, "mode"], next);
  };
  const onDirection = (value: string) =>
    writeMode((f) => {
      delete f.input;
      delete f.output;
      if (value === "input" || value === "both") f.input = true;
      if (value === "output" || value === "both") f.output = true;
    });
  const onPull = (value: string) =>
    writeMode((f) => {
      delete f.pullup;
      delete f.pulldown;
      if (value === "pullup") f.pullup = true;
      if (value === "pulldown") f.pulldown = true;
    });

  const uid = `pin-wiring-${path.join("-")}`;
  const radios = (
    labelId: string,
    value: string,
    onChange: (value: string) => void,
    options: Array<[string, string]>
  ) => html`
    <wa-radio-group
      class="pin-wiring-radios"
      aria-labelledby=${labelId}
      .value=${value}
      ?disabled=${fieldDisabled}
      @change=${(e: Event) => onChange((e.target as unknown as { value: string }).value)}
    >
      ${options.map(
        ([v, key]) => html`<wa-radio value=${v}>${ctx.localize(key)}</wa-radio>`
      )}
    </wa-radio-group>
  `;

  return html`
    <div class="pin-wiring-custom">
      <div class="pin-wiring-row">
        <span class="field-label" id="${uid}-direction">
          ${ctx.localize("device.pin_wiring_direction")}
        </span>
        <p class="field-description">
          ${ctx.localize("device.pin_wiring_direction_description")}
        </p>
        ${wiringDiagram("direction")}
        ${radios(`${uid}-direction`, direction, onDirection, [
          ["input", "device.pin_wiring_direction_input"],
          ["output", "device.pin_wiring_direction_output"],
          ["both", "device.pin_wiring_direction_both"],
        ])}
      </div>
      <div class="pin-wiring-row">
        <span class="field-label" id="${uid}-pull">
          ${ctx.localize("device.pin_wiring_pull")}
        </span>
        <p class="field-description">
          ${ctx.localize("device.pin_wiring_pull_description")}
        </p>
        ${wiringDiagram("pull_resistor")}
        ${radios(`${uid}-pull`, pull, onPull, [
          ["none", "device.pin_wiring_pull_none"],
          ["pullup", "device.pin_wiring_pull_up"],
          ["pulldown", "device.pin_wiring_pull_down"],
        ])}
      </div>
      ${
        flags.open_drain || direction === "output" || direction === "both"
          ? html`<div class="switch-field">
              <div class="field-info">
                <label class="field-label">
                  ${ctx.localize("device.pin_wiring_open_drain")}
                </label>
                <p class="field-description">
                  ${ctx.localize("device.pin_wiring_open_drain_description")}
                </p>
              </div>
              <wa-switch
                ?checked=${!!flags.open_drain}
                ?disabled=${fieldDisabled}
                aria-label=${ctx.localize("device.pin_wiring_open_drain")}
                @change=${(e: Event) =>
                  writeMode((f) => {
                    f.open_drain = (
                      e.target as HTMLInputElement & { checked: boolean }
                    ).checked;
                  })}
              ></wa-switch>
            </div>`
          : nothing
      }
      ${invertedChild ? renderLongFormChild(invertedChild, path, ctx) : nothing}
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
  // The wiring disclosure is itself the advanced gate: the flag children
  // are catalog-marked ``advanced``, and the generic nested renderer
  // would drop them while the global Show-advanced toggle is off,
  // leaving an empty Mode box. Strip the mark so they always render here.
  const revealed: ConfigEntry = {
    ...scoped,
    config_entries: (scoped.config_entries ?? []).map((c) =>
      c.advanced ? { ...c, advanced: false } : c
    ),
  };
  // A scalar shorthand (``mode: OUTPUT``) needs the display-expansion
  // wrapper; a ``${var}`` scalar goes through renderEntry so the form's
  // substitution gate edits it as text with the resolves-to hint (#1343);
  // the object form goes through the normal nested dispatch. Deliberately
  // ``looksLikeSubstitution``, not ``isSubstitutionString`` — the typeof
  // guard is load-bearing (an object mode must not hit the wrapper).
  return typeof modeValue === "string" && !looksLikeSubstitution(modeValue)
    ? renderPinModeField(revealed, modePath, ctx)
    : ctx.renderEntry(revealed, modePath);
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
