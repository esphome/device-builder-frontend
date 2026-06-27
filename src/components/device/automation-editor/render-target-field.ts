/**
 * The automation editor's read-only Target identity field. Kept as a pure
 * function (not a method) so it can be unit-tested without mounting the editor,
 * which pulls in CodeMirror. Renders the raw target value plus the shared
 * ``${var}`` / ``$var`` resolved-hint chip, matching the text-field UX.
 */
import { html } from "lit";

import type { LocalizeFunc } from "../../../common/localize.js";
import { renderSubstitutionHint } from "../config-entry-renderers-shared.js";

export function renderTargetField(
  targetValue: string,
  substitutions: Map<string, string>,
  localize: LocalizeFunc
) {
  return html`<div class="field">
    <label class="field-label"> ${localize("device.automation_target")} </label>
    <input type="text" readonly .value=${targetValue} />
    ${renderSubstitutionHint(targetValue, substitutions, localize)}
  </div>`;
}
