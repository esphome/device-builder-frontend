import type { AutomationAction } from "../src/api/types/automations.js";

/** An action catalog entry; ``domain`` defaults to the id's prefix, or
 *  ``core`` for a bare id like ``delay``. */
export function makeAutomationAction(
  overrides: Partial<AutomationAction> & { id: string }
): AutomationAction {
  const { id } = overrides;
  return {
    name: id,
    description: "",
    docs_url: "",
    domain: id.includes(".") ? id.split(".")[0] : "core",
    config_entries: [],
    is_control_flow: false,
    has_else_branch: false,
    accepts_action_list: [],
    ...overrides,
  };
}
