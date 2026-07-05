/**
 * The automation editor's component-style header card. Kept as a
 * pure function (not a method) matching ``render-target-field.ts``,
 * so it stays testable without mounting the editor.
 *
 * Title is the catalog-resolved domain + trigger name
 * (``Switch → Turn on``) so it matches the navigator's primary
 * label and gives the user the same eye-line cue they get from
 * clicking a regular component.
 *
 * For ``interval`` automations we reach further and pull the
 * ``interval`` component catalog entry so the user gets the same
 * name / description / docs / image they'd see in a regular
 * component editor — no more bland generic "Automation".
 *
 * Title decomposes to the kind label (``Automation``) when we
 * don't have enough metadata yet — fresh add-mode (no trigger
 * picked) or script / light_effect locations.
 */
import { mdiArrowDecisionOutline, mdiOpenInNew } from "@mdi/js";
import { html, nothing } from "lit";

import type {
  AutomationLocation,
  AutomationTrigger,
} from "../../../api/types/automations.js";
import type { ComponentCatalogEntry } from "../../../api/types/components.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { automationHeaderTitle } from "../../../util/automation-header-title.js";
import { renderMarkdown } from "../../../util/markdown.js";
import { registerMdiIcons } from "../../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "arrow-decision-outline": mdiArrowDecisionOutline,
  "open-in-new": mdiOpenInNew,
});

export function renderAutomationHeader(
  location: AutomationLocation | null,
  intervalComponent: ComponentCatalogEntry | null,
  activeTrigger: AutomationTrigger | null,
  localize: LocalizeFunc
) {
  const intervalComp = location?.kind === "interval" ? intervalComponent : null;
  const title =
    intervalComp?.name ?? automationHeaderTitle(location, activeTrigger, localize);
  const docsUrl = intervalComp?.docs_url ?? activeTrigger?.docs_url ?? "";
  const descText =
    intervalComp?.description ??
    activeTrigger?.description ??
    localize("device.automation_header_description");
  const imageUrl = intervalComp?.image_url ?? "";
  return html`<div class="ae-header">
    <div class="ae-header-text">
      <h2 class="ae-header-title">${title}</h2>
      ${
        docsUrl
          ? html`<a
              class="ae-header-docs"
              href=${docsUrl}
              target="_blank"
              rel="noreferrer"
            >
              ${localize("device.docs")}
              <wa-icon library="mdi" name="open-in-new"></wa-icon>
            </a>`
          : nothing
      }
      <p class="ae-header-desc">${renderMarkdown(descText)}</p>
    </div>
    <div class="ae-header-icon">
      ${
        imageUrl
          ? html`<img alt="" src=${imageUrl} />`
          : html`<wa-icon library="mdi" name="arrow-decision-outline"></wa-icon>`
      }
    </div>
  </div>`;
}
