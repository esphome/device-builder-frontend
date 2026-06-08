import { mdiArrowDecisionOutline, mdiCogOutline, mdiMemory } from "@mdi/js";
import { registerMdiIcons } from "../../util/register-icons.js";

/**
 * Canonical per-section icons, shared by the navigator's section
 * headers and the overview pane's step buttons so the two surfaces
 * never drift. Importing this module registers the mdi paths once.
 */
export const SECTION_ICON = {
  core: "cog-outline",
  components: "memory",
  automations: "arrow-decision-outline",
} as const;

registerMdiIcons({
  [SECTION_ICON.core]: mdiCogOutline,
  [SECTION_ICON.components]: mdiMemory,
  [SECTION_ICON.automations]: mdiArrowDecisionOutline,
});
