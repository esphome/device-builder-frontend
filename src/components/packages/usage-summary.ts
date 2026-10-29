/** "Who uses this file" block for the rename and delete prompts. */
import { css, html, nothing, type TemplateResult } from "lit";
import type { ConfiguredDevice } from "../../api/types/devices.js";
import type { FileUsage } from "../../api/types/files.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { deviceItems, fileItems, renderLinkList } from "./link-list.js";

export const NO_USAGE: FileUsage = {
  used_by: [],
  unknown: [],
  referenced_by: [],
  rewritable: [],
};

/** Direct includers not already shown as devices: packages, archived devices
 *  and devices the scanner hasn't loaded yet. */
export function otherReferrers(usage: FileUsage): string[] {
  const shown = new Set([...usage.used_by, ...usage.unknown]);
  return usage.referenced_by.filter((path) => !shown.has(path));
}

/**
 * The using devices as links, under *usedKey* (``{count}``), then the other
 * files that include it. *unusedKey* only shows when nothing does and every
 * device was checked; unchecked ones (config doesn't load yet) are named in
 * a note instead of being reported as non-users.
 */
export function renderUsageSummary(
  usage: FileUsage,
  opts: {
    localize: LocalizeFunc;
    devices: readonly ConfiguredDevice[];
    usedKey: string;
    unusedKey: string;
    open: (url: string) => void;
  }
): TemplateResult {
  const { localize, used_by: used } = { localize: opts.localize, ...usage };
  const others = otherReferrers(usage);
  const message =
    used.length > 0
      ? localize(opts.usedKey, { count: used.length })
      : usage.unknown.length === 0 && others.length === 0
        ? localize(opts.unusedKey)
        : "";
  return html`${message ? html`<p class="usage-message">${message}</p>` : nothing}
  ${renderLinkList(deviceItems(used, opts.devices), opts.open)}
  ${
    others.length > 0
      ? html`<p class="usage-message">
            ${localize("packages.usage_other_files", { count: others.length })}
          </p>
          ${renderLinkList(fileItems(others), opts.open)}`
      : nothing
  }
  ${
    usage.unknown.length > 0
      ? html`<p class="usage-note">
          ${localize("packages.usage_unknown", { names: usage.unknown.join(", ") })}
        </p>`
      : nothing
  }`;
}

export const usageSummaryStyles = css`
  .usage-message,
  .usage-note {
    margin: var(--wa-space-s) 0;
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
    line-height: 1.5;
  }
`;
