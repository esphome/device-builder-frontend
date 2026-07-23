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
import { ConfigEntryType, PinMode } from "../../api/types/config-entries.js";
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
import { looksLikeSubstitution } from "../../util/substitutions.js";
import { onChoiceGroupKeydown } from "../shared/choice-group.js";
import { renderDisclosure } from "../shared/disclosure.js";
import {
  providerAllowedModes,
  renderCustomEditor,
  renderLongFormChild,
  wiringDiagram,
} from "./config-entry-pin-mode.js";
import {
  fieldKeyAttr,
  filterChildEntries,
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
  const { entry, path, ctx, rawValue, isLongForm, fieldDisabled, boardPin } = opts;
  // Force-include the wiring fields (mode + inverted) past the global
  // Show-advanced toggle: how a button or relay is wired is not an
  // advanced nicety. The other catalog-advanced extras (the strapping /
  // validation escape hatches, drive_strength) keep the normal gating,
  // and platform / depends_on gating applies throughout.
  const pinValues = ctx.scopeValues(path);
  const advancedFields = filterChildEntries(entry.config_entries ?? [], pinValues, ctx, {
    includeAdvanced: true,
  });
  const gatedKeys = new Set(
    ctx.filterRenderable(entry.config_entries ?? [], pinValues).map((c) => c.key)
  );
  const longFormFields = advancedFields.filter(
    (c) => c.key === "mode" || c.key === "inverted" || gatedKeys.has(c.key)
  );
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

  // A board-preset pin carries the board's known-good wiring; edits are
  // view-only until the user flips the unlock. Session-transient, so the
  // guard re-arms on reload.
  const guardKey = `${path.join(".")}:pin-guard`;
  const boardPreset = opts.boardPreset;
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
  // While guarded, everything inside the panel renders read-only. The
  // ``disabled`` copy alone is not enough: ``ctx.renderEntry`` closes
  // over the form's original ctx, so children routed through the
  // dispatch would still see ``disabled: false``. Lock the entries
  // themselves at every depth — ``effectiveDisabled`` honors
  // ``entry.locked`` in every renderer.
  const panelCtx: RenderCtx = guarded
    ? {
        ...ctx,
        disabled: true,
        renderEntry: (child, childPath) =>
          ctx.renderEntry(lockEntryDeep(child), childPath),
      }
    : ctx;
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
                currentInverted: parseYamlBoolean(invertedValue) === true,
                bannerKey:
                  entry.pin_mode === PinMode.OUTPUT
                    ? "device.pin_wiring_input_only_banner_output"
                    : "device.pin_wiring_input_only_banner",
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
  /** The stored ``inverted``, for cards whose pick preserves it. */
  currentInverted: boolean;
  /** Direction-appropriate input-only banner copy. */
  bannerKey: string;
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
        ${ctx.localize(opts.bannerKey, { pin: boardPin!.label })}
      </div>`
    : nothing;

  const invertedChild = longFormFields.find((c) => c.key === "inverted");
  const others = longFormFields.filter((c) => c.key !== "mode" && c.key !== "inverted");

  const selectedId = showCustom
    ? "custom"
    : state.kind === "preset"
      ? state.preset.id
      : null;
  // The roving tab stop must land on a focusable card: the selected one
  // when enabled, else the first enabled card. A disabled selected card
  // (its preset guardrailed by the board pin) or an all-disabled preset
  // row would otherwise leave the radiogroup unreachable by keyboard —
  // Custom is the natural fallback then.
  const cardEnabled = [
    ...presets.map((_, i) => !editDisabled && reasons[i] === null),
    !editDisabled,
  ];
  const selectedIndex = showCustom
    ? presets.length
    : presets.findIndex((p) => p.id === selectedId);
  const tabStopIndex =
    selectedIndex >= 0 && cardEnabled[selectedIndex]
      ? selectedIndex
      : cardEnabled.indexOf(true);
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
          i === tabStopIndex,
          reasons[i] ? unavailableText : "",
          // A pick preserves the stored inverted when the preset doesn't
          // care, so the tech line must reflect it for those cards.
          preset.invertedWrite ?? opts.currentInverted,
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

/** *entry* with itself and every descendant marked locked, so children
 *  routed through the form's dispatch render read-only via
 *  ``effectiveDisabled`` at every depth. */
function lockEntryDeep(entry: ConfigEntry): ConfigEntry {
  return {
    ...entry,
    locked: true,
    config_entries: entry.config_entries?.map(lockEntryDeep) ?? entry.config_entries,
  };
}

function renderPresetCard(
  preset: WiringPreset,
  selected: boolean,
  tabbable: boolean,
  reasonText: string,
  techInverted: boolean,
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
      ${wiringTechSummary(preset.flags, techInverted)}
    </code>
  </button>`;
}
