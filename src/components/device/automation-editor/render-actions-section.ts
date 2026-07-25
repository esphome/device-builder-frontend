/**
 * The Actions section shared by all three editors: label,
 * description, and the recursive action list (whose bottom Add
 * button opens the picker).
 */
import { html } from "lit";

import type {
  AutomationAction,
  AutomationCondition,
  AutomationTree,
  AvailableComponentInstance,
  AvailableScript,
} from "../../../api/types/automations.js";
import type { BoardCatalogEntry } from "../../../api/types/boards.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { renderMarkdown } from "../../../util/markdown.js";
import "./automation-action-list.js";
import type { AutomationFocus } from "./automation-focus.js";

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
  /** Required so each editor names its own copy — a fallback would
   *  silently render the automation flavour under a script. */
  descriptionKey: string;
  onActionsChange: (e: CustomEvent<{ actions: AutomationTree["actions"] }>) => void;
}) {
  return html`
    <div class="field">
      <label class="field-label"> ${opts.localize("device.automation_action")} </label>
      <p class="field-description">
        ${renderMarkdown(opts.localize(opts.descriptionKey))}
      </p>
      <esphome-automation-action-list
        no-header
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
