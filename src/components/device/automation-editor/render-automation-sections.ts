/**
 * The automation editor's body sections, as pure render functions
 * (matching ``render-target-field.ts``): the legacy add-mode
 * pickers, the edit-mode trigger-params form, the actions list
 * section, and the delete footer. State stays in
 * ``<esphome-automation-editor>``; each section receives values
 * plus the host's stable handler references.
 */
import { mdiDelete } from "@mdi/js";
import { html, nothing } from "lit";

import type {
  AutomationAction,
  AutomationCondition,
  AutomationLocation,
  AutomationTree,
  AutomationTrigger,
  AvailableComponentInstance,
  AvailableScript,
} from "../../../api/types/automations.js";
import type { BoardCatalogEntry } from "../../../api/types/boards.js";
import type { ComponentCatalogEntry } from "../../../api/types/components.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { renderMarkdown } from "../../../util/markdown.js";
import { registerMdiIcons } from "../../../util/register-icons.js";
import { triggerParamFormEntries } from "../../../util/trigger-param-form-entries.js";
import "../config-entry-form.js";
import "./automation-action-list.js";
import type { AutomationFocus } from "./automation-focus.js";
import "./automation-target-picker.js";
import "./automation-trigger-picker.js";
import { renderTargetField } from "./render-target-field.js";
import { targetMetadataValue } from "./trigger-identity.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ delete: mdiDelete });

/**
 * Legacy add-mode pickers. The "+ Add automation" wizard now
 * collects target / trigger before mounting the editor, so this
 * path isn't normally reached from the navigator — kept for
 * back-compat if a parent ever instantiates the editor in
 * add-mode directly.
 */
export function renderAddModePickers(opts: {
  target: AutomationLocation | null;
  triggers: AutomationTrigger[];
  devices: AvailableComponentInstance[];
  scripts: AvailableScript[];
  effectiveTriggerId: string | null;
  automation: AutomationTree;
  board: BoardCatalogEntry | null;
  yaml: string;
  disabled: boolean;
  onTargetChange: (e: CustomEvent<{ target: AutomationLocation | null }>) => void;
  onTriggerChange: (
    e: CustomEvent<{ triggerId: string; params: Record<string, unknown> }>
  ) => void;
  onTriggerParamsChange: (e: CustomEvent<{ params: Record<string, unknown> }>) => void;
}) {
  return html`
    <esphome-automation-target-picker
      .value=${opts.target}
      .devices=${opts.devices}
      .scripts=${opts.scripts}
      ?disabled=${opts.disabled}
      @target-change=${opts.onTargetChange}
    ></esphome-automation-target-picker>
    <esphome-automation-trigger-picker
      .target=${opts.target}
      .triggers=${opts.triggers}
      .devices=${opts.devices}
      .triggerId=${opts.effectiveTriggerId}
      .triggerParams=${opts.automation.trigger_params}
      .board=${opts.board}
      .yaml=${opts.yaml}
      ?disabled=${opts.disabled}
      @trigger-change=${opts.onTriggerChange}
      @trigger-params-change=${opts.onTriggerParamsChange}
    ></esphome-automation-trigger-picker>
  `;
}

/**
 * Trigger param form for edit-mode. The target / trigger
 * dropdowns are gone — those become read-only metadata in the
 * header. Only the trigger's ``config_entries`` need a form,
 * since those ARE editable on an existing automation (e.g.
 * tweaking ``min_length`` on an ``on_click`` trigger after the
 * fact).
 *
 * ``interval`` automations special-case: the trigger
 * (``interval.then``) carries no config_entries, but the parent
 * ``interval`` *component* does — ``interval:`` (time), ``id:``,
 * ``startup_delay:`` etc. all live in ``trigger_params`` in the
 * AutomationTree, so render them from the component schema
 * (filtered to drop ``then:``, which is the actions block).
 */
export function renderTriggerParamsForm(opts: {
  location: AutomationLocation | null;
  intervalComponent: ComponentCatalogEntry | null;
  activeTrigger: AutomationTrigger | null;
  automation: AutomationTree;
  board: BoardCatalogEntry | null;
  yaml: string;
  disabled: boolean;
  showAdvanced: boolean;
  focusFieldPath?: string[];
  onValueChange: (e: CustomEvent<{ path: string[]; value: unknown }>) => void;
  onAdvancedToggle: (e: CustomEvent<{ show: boolean }>) => void;
}) {
  const entries = triggerParamFormEntries(
    opts.location,
    opts.intervalComponent,
    opts.activeTrigger
  );
  if (entries.length === 0) return nothing;
  // No outer wrapper / no synthetic group label: the form renders
  // each entry with its own catalog-derived label + description,
  // and a section header above that ("Interval" / "Trigger
  // options") would just duplicate the first field's name. Sit as
  // a sibling of the header and the action-list so the :host gap
  // alone handles vertical rhythm.
  return html`
    <esphome-config-entry-form
      .entries=${entries}
      .values=${opts.automation.trigger_params}
      .board=${opts.board}
      .yaml=${opts.yaml}
      .focusFieldPath=${opts.focusFieldPath}
      ?disabled=${opts.disabled}
      advanced-section
      ?show-advanced=${opts.showAdvanced}
      @value-change=${opts.onValueChange}
      @advanced-toggle=${opts.onAdvancedToggle}
    ></esphome-config-entry-form>
  `;
}

/** The Actions section: label + header-positioned Add button
 *  (opens the picker dialog living inside the action-list) and
 *  the recursive action list itself. */
export function renderActionsSection(opts: {
  automation: AutomationTree;
  catalog: AutomationAction[];
  conditionCatalog: AutomationCondition[];
  scripts: AvailableScript[];
  devices: AvailableComponentInstance[];
  board: BoardCatalogEntry | null;
  yaml: string;
  disabled: boolean;
  localize: LocalizeFunc;
  focusTarget?: AutomationFocus | null;
  onOpenPicker: () => void;
  onActionsChange: (e: CustomEvent<{ actions: AutomationTree["actions"] }>) => void;
}) {
  return html`
    <div class="field">
      <div class="ae-actions-header">
        <label class="field-label"> ${opts.localize("device.automation_action")} </label>
        <button
          type="button"
          class="ae-section-add"
          ?disabled=${opts.disabled || opts.catalog.length === 0}
          @click=${opts.onOpenPicker}
        >
          <wa-icon library="mdi" name="plus"></wa-icon>
          ${opts.localize("device.add_action")}
        </button>
      </div>
      <p class="field-description">
        ${renderMarkdown(opts.localize("device.automation_actions_description"))}
      </p>
      <esphome-automation-action-list
        no-header
        hide-add
        .focusTarget=${opts.focusTarget ?? null}
        .actions=${opts.automation.actions}
        .catalog=${opts.catalog}
        .conditionCatalog=${opts.conditionCatalog}
        .scripts=${opts.scripts}
        .devices=${opts.devices}
        .board=${opts.board}
        .yaml=${opts.yaml}
        ?disabled=${opts.disabled}
        @actions-change=${opts.onActionsChange}
      ></esphome-automation-action-list>
    </div>
  `;
}

/**
 * Read-only target field — the only identity field we still
 * surface, and only for ``component_on`` / ``component_action``:
 * the catalog name (``Switch → On Turn On``) already sits as the
 * editor's header title so a separate "Trigger" row underneath was
 * just a copy of it, and ``device_on`` / ``interval`` have no
 * meaningful target to display either ("the device itself" /
 * "Interval #1" read as filler). Leaves only "which component
 * instance is this automation bound to" — the one piece of
 * identity the header can't carry.
 */
export function renderIdentityFields(
  location: AutomationLocation | null,
  devices: AvailableComponentInstance[],
  substitutions: Map<string, string>,
  localize: LocalizeFunc
) {
  if (!location) return nothing;
  if (location.kind !== "component_on" && location.kind !== "component_action") {
    return nothing;
  }
  return renderTargetField(
    targetMetadataValue(location, devices, localize),
    substitutions,
    localize
  );
}

/** Edit-mode footer: the destructive Delete button. */
export function renderDeleteRow(
  localize: LocalizeFunc,
  disabled: boolean,
  onDelete: () => void
) {
  return html`<div class="ae-actions">
    <button type="button" class="ae-danger" ?disabled=${disabled} @click=${onDelete}>
      <wa-icon library="mdi" name="delete"></wa-icon>
      ${localize("device.delete_automation")}
    </button>
  </div>`;
}
