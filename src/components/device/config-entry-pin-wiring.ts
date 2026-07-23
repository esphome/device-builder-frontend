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
import { ConfigEntryType, PinFeature, PinMode } from "../../api/types/config-entries.js";
import { isPlainObject } from "../../util/nested-values.js";
import { isSubstitutionString } from "../../util/substitutions.js";
import {
  applyPresetToPin,
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
import { onChoiceGroupKeydown, rovingTabStopIndex } from "../shared/choice-group.js";
import { renderDisclosure } from "../shared/disclosure.js";
import {
  providerAllowedModes,
  renderCustomEditor,
  renderLongFormChild,
  wiringDiagram,
} from "./config-entry-pin-mode.js";
import {
  fieldKeyAttr,
  type LockedReasonCarrier,
  type RenderCtx,
} from "./config-entry-renderers-shared.js";

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
  const { entry, path, ctx, rawValue, isLongForm, fieldDisabled, boardPin, boardPreset } =
    opts;
  // The wiring fields (mode + inverted) are not an advanced nicety:
  // normalize their catalog ``advanced`` marks off (children too, so the
  // empty-group drop can't eat the mode box while Show advanced is off)
  // and let the form's own filter decide everything else — the strapping
  // / validation escape hatches and drive_strength keep normal gating.
  const source = (entry.config_entries ?? []).map((c) =>
    c.key === "mode" || c.key === "inverted" ? stripAdvancedDeep(c) : c
  );
  const pinValues = ctx.scopeValues(path);
  const longFormFields = ctx.filterRenderable(source, pinValues);
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
  // And only when every stored wiring value is readable — a ``${var}``
  // mode or inverted must fall through to the raw disclosure, where the
  // substitution gate owns it (a preset pick would clobber the
  // reference), and a ``${var}`` number leaves the actual GPIO unknown,
  // so the input-only guardrail could not vouch for the cards.
  const flags = modeFlagsOf(modeValue);
  const invertedReadable =
    invertedValue === undefined ||
    invertedValue === null ||
    parseYamlBoolean(invertedValue) !== null;
  const presets =
    modeChild &&
    ctx.sectionKey.endsWith(".gpio") &&
    providerAllowedModes(rawValue, ctx.pinRegistryModes) === null &&
    flags !== null &&
    invertedReadable &&
    !(isPlainObject(rawValue) && isSubstitutionString(rawValue.number))
      ? presetsForPinMode(entry.pin_mode)
      : [];
  const usePresets = presets.length > 0;

  // A board-preset pin carries the board's known-good wiring; edits are
  // view-only until the user flips the unlock. Session-transient, so the
  // guard re-arms on reload.
  const guardKey = `${path.join(".")}:pin-guard`;
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
    // read what the pin is set to without opening the section. The
    // presets gate above guarantees readable values here.
    const currentTech = implicitPreset
      ? wiringTechSummary(implicitPreset.flags, false)
      : wiringTechSummary(flags ?? {}, parseYamlBoolean(invertedValue) === true);
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
            class="pin-wiring-guard-switch"
            ?checked=${!guarded}
            @change=${onGuardToggle}
          >
            ${ctx.localize("device.pin_wiring_guard_unlock")}
          </wa-switch>
        </div>`
      : nothing;
  // While guarded or hard-locked, everything inside the panel renders
  // read-only. The ``disabled`` copy alone is not enough:
  // ``ctx.renderEntry`` closes over the form's original ctx, so children
  // routed through the dispatch would still see ``disabled: false``.
  // Lock the entries themselves at every depth — ``effectiveDisabled``
  // honors ``entry.locked`` in every renderer. The guard's unlock hint
  // only applies while the guard (not a hard lock) is what's blocking.
  const panelCtx: RenderCtx =
    guarded || fieldDisabled
      ? {
          ...ctx,
          disabled: true,
          renderEntry: (child, childPath) =>
            ctx.renderEntry(lockEntryDeep(child, guarded), childPath),
        }
      : ctx;
  const editDisabled = fieldDisabled || guarded;

  return html`
    <div class="pin-advanced" data-field-key="${advancedKey}">
      ${
        // One reveal marker per gated field, so the YAML cursor landing on
        // ``mode`` / ``inverted`` opens the collapsed section while the
        // ungated ``pin`` / ``number`` lines leave it shut.
        longFormFields.map(
          (c) =>
            html`<span
              hidden
              data-reveal-for=${fieldKeyAttr([...path, c.key])}
              data-field-key="${advancedKey}"
            ></span>`
        )
      }
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
          html`${guardRow}
          ${
            usePresets
              ? renderWiringPanel({
                  longFormFields,
                  modeChild: modeChild!,
                  pinMode: entry.pin_mode ?? null,
                  invertedValue,
                  guardTooltip: guarded
                    ? ctx.localize("device.pin_wiring_guard_tooltip")
                    : "",
                  path,
                  ctx: panelCtx,
                  rawValue,
                  presets,
                  state,
                  boardPin,
                  editDisabled,
                })
              : longFormFields.map((child) => renderLongFormChild(child, path, panelCtx))
          }`,
      })}
    </div>
  `;
}

interface WiringPanelOptions {
  longFormFields: ConfigEntry[];
  modeChild: ConfigEntry;
  pinMode: PinMode | null;
  /** The stored ``inverted``, for cards whose pick preserves it. */
  invertedValue: unknown;
  /** Non-empty while the board-preset guard is armed; hovers explain it. */
  guardTooltip: string;
  path: string[];
  ctx: RenderCtx;
  rawValue: unknown;
  presets: WiringPreset[];
  state: WiringState;
  boardPin: BoardPin | null;
  editDisabled: boolean;
}

function renderWiringPanel(opts: WiringPanelOptions): TemplateResult {
  const { longFormFields, path, ctx, presets, state, boardPin, editDisabled } = opts;
  const modeValue = isPlainObject(opts.rawValue) ? opts.rawValue.mode : undefined;
  const currentInverted = parseYamlBoolean(opts.invertedValue) === true;
  const choiceKey = `${path.join(".")}:pin-wiring`;
  const showCustom =
    ctx.getClusterChoice(choiceKey) === "custom" || state.kind === "custom";

  const pickPreset = (preset: WiringPreset) => {
    // Same belt-and-braces as every other mutating handler: the missing
    // click binding alone must not be the guardrail.
    if (editDisabled || presetUnavailableReason(preset, boardPin) !== null) return;
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
        ${ctx.localize(
          opts.pinMode === PinMode.OUTPUT
            ? "device.pin_wiring_input_only_banner_output"
            : "device.pin_wiring_input_only_banner",
          { pin: boardPin!.label }
        )}
      </div>`
    : nothing;

  const invertedChild = longFormFields.find((c) => c.key === "inverted");
  const others = longFormFields.filter((c) => c.key !== "mode" && c.key !== "inverted");

  // The Custom card sits at index ``presets.length``. A disabled
  // selected card (its preset guardrailed by the board pin) or an
  // all-disabled preset row must not own the tab stop, or the radiogroup
  // becomes unreachable by keyboard — Custom is the natural fallback.
  const selectedIndex = showCustom
    ? presets.length
    : state.kind === "preset"
      ? presets.indexOf(state.preset)
      : -1;
  const cardEnabled = [
    ...presets.map((_, i) => !editDisabled && reasons[i] === null),
    !editDisabled,
  ];
  const enabledTabStop = rovingTabStopIndex(selectedIndex, cardEnabled);
  // With every card unavailable (the board-preset guard armed), keep one
  // aria-disabled card in the tab order — the group must stay reachable
  // so its state and tooltip are discoverable by keyboard.
  const tabStopIndex =
    enabledTabStop !== -1 ? enabledTabStop : selectedIndex >= 0 ? selectedIndex : 0;
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
          i === selectedIndex,
          i === tabStopIndex,
          reasons[i] ? unavailableText : "",
          // The selected card describes the pin as it IS (matching the
          // summary line); unselected cards advertise what a pick would
          // write, preserving the stored inverted when they don't care.
          i === selectedIndex
            ? currentInverted
            : (preset.invertedWrite ?? currentInverted),
          opts.guardTooltip,
          editDisabled,
          () => pickPreset(preset),
          ctx
        )
      )}
      <button
        type="button"
        class="pin-wiring-card${showCustom ? " pin-wiring-card--selected" : ""}"
        data-preset="custom"
        role="radio"
        aria-checked=${showCustom ? "true" : "false"}
        tabindex=${tabStopIndex === presets.length ? "0" : "-1"}
        title=${opts.guardTooltip || nothing}
        aria-disabled=${editDisabled ? "true" : "false"}
        @click=${editDisabled ? nothing : pickCustom}
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
            editDisabled,
            boardPin?.features.includes(PinFeature.INPUT_ONLY) ?? false
          )
        : nothing
    }
    ${others.map((child) => renderLongFormChild(child, path, ctx))}
  `;
}

/** *entry* with the catalog ``advanced`` mark stripped from itself and
 *  every descendant, so the form's filter keeps it regardless of the
 *  global Show-advanced toggle. */
function stripAdvancedDeep(entry: ConfigEntry): ConfigEntry {
  return {
    ...entry,
    advanced: false,
    config_entries: entry.config_entries?.map(stripAdvancedDeep) ?? entry.config_entries,
  };
}

/** *entry* with itself and every descendant marked locked, so children
 *  routed through the form's dispatch render read-only via
 *  ``effectiveDisabled`` at every depth. While *guarded*, the lock icons
 *  explain the guard's unlock instead of claiming the board set the
 *  field. */
function lockEntryDeep(entry: ConfigEntry, guarded: boolean): ConfigEntry {
  const locked: ConfigEntry & LockedReasonCarrier = {
    ...entry,
    locked: true,
    config_entries:
      entry.config_entries?.map((c) => lockEntryDeep(c, guarded)) ?? entry.config_entries,
  };
  if (guarded) locked.locked_reason_key = "device.pin_wiring_guard_tooltip";
  return locked;
}

function renderPresetCard(
  preset: WiringPreset,
  selected: boolean,
  tabbable: boolean,
  reasonText: string,
  techInverted: boolean,
  guardTooltip: string,
  editDisabled: boolean,
  onPick: () => void,
  ctx: RenderCtx
): TemplateResult {
  const classes = ["pin-wiring-card", selected ? "pin-wiring-card--selected" : ""]
    .filter(Boolean)
    .join(" ");
  const unavailable = editDisabled || !!reasonText;
  return html`<button
    type="button"
    class=${classes}
    data-preset=${preset.id}
    role="radio"
    aria-checked=${selected ? "true" : "false"}
    tabindex=${tabbable ? "0" : "-1"}
    title=${guardTooltip || nothing}
    aria-disabled=${unavailable ? "true" : "false"}
    @click=${unavailable ? nothing : onPick}
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
      ${wiringTechSummary(preset.flags, techInverted)}
    </code>
  </button>`;
}
