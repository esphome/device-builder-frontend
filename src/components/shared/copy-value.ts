import { mdiContentCopy } from "@mdi/js";
import { html, type TemplateResult } from "lit";
import type { LocalizeFunc } from "../../common/localize.js";
import { copyWithToast } from "../../util/copy-value.js";
import { registerMdiIcons } from "../../util/register-icons.js";

registerMdiIcons({ "content-copy": mdiContentCopy });

export interface CopyValueLabels {
  ariaLabel: string;
  title: string;
  okKey: string;
  failKey: string;
}

/** A click-to-copy code value; pair with copyValueStyles. */
export function renderCopyValue(
  localize: LocalizeFunc,
  value: string,
  labels: CopyValueLabels
): TemplateResult {
  return html`
    <button
      type="button"
      class="copy-value"
      aria-label=${labels.ariaLabel}
      title=${labels.title}
      @click=${() => void copyWithToast(localize, value, labels.okKey, labels.failKey)}
    >
      <code>${value}</code>
      <wa-icon library="mdi" name="content-copy"></wa-icon>
    </button>
  `;
}
