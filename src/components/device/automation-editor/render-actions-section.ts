/**
 * The Actions section shared by all three editors: label,
 * description, and the recursive action list (whose bottom Add
 * button opens the picker).
 */
import { html } from "lit";
import { keyed } from "lit/directives/keyed.js";

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
import "./catalog-picker-host.js";
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
  /** Names the automation being edited. The editor element is reused from
   *  one automation to the next, and every node of the new tree is a new
   *  object, so the list is remounted rather than left to carry each row's
   *  state over by position. */
  targetKey: string;
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
      <esphome-catalog-picker-host>
        ${keyed(
          opts.targetKey,
          html`<esphome-automation-action-list
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
          ></esphome-automation-action-list>`
        )}
      </esphome-catalog-picker-host>
    </div>
  `;
}
