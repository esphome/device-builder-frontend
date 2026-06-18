import { html, type TemplateResult } from "lit";
import { classMap } from "lit/directives/class-map.js";

import type { LocalizeFunc } from "../../common/localize.js";

export interface ToggleRowOptions {
  titleId: string;
  titleKey: string;
  descKey: string;
  checked: boolean | null;
  onToggle: () => void;
  /** Loading-row description key; required when `checked` can be `null`. */
  loadingDescKey?: string;
  /** Extra class on the live `.row` (e.g. ``expert-row``). */
  rowClass?: string;
}

/**
 * Settings toggle row: title + description and a `role=switch` button.

 * A `null` `checked` renders the button-less loading variant (title +
 * `loadingDescKey`) instead.
 */
export function renderToggleRow(
  localize: LocalizeFunc,
  opts: ToggleRowOptions
): TemplateResult {
  if (opts.checked === null) {
    return html`
      <div class="row" role="status">
        <div class="row-label">
          <span class="row-title">${localize(opts.titleKey)}</span>
          <span class="row-desc"> ${localize(opts.loadingDescKey ?? opts.descKey)} </span>
        </div>
      </div>
    `;
  }
  const rowClasses = classMap({
    row: true,
    ...(opts.rowClass ? { [opts.rowClass]: true } : {}),
  });
  return html`
    <div class=${rowClasses}>
      <div class="row-label">
        <span id=${opts.titleId} class="row-title"> ${localize(opts.titleKey)} </span>
        <span class="row-desc">${localize(opts.descKey)}</span>
      </div>
      <button
        class="toggle"
        role="switch"
        aria-labelledby=${opts.titleId}
        aria-checked=${opts.checked}
        @click=${opts.onToggle}
      ></button>
    </div>
  `;
}

/** Desc-only status row (loading / empty / failure messages). */
export function renderStatusRow(
  localize: LocalizeFunc,
  key: string,
  role: "status" | "alert" = "status"
): TemplateResult {
  return html`
    <div class="row" role=${role}>
      <div class="row-label">
        <span class="row-desc">${localize(key)}</span>
      </div>
    </div>
  `;
}
