/** A list of devices or files whose rows open an editor; shared by the
 *  usage / dependencies dialog and the delete confirm. */
import { css, html, nothing, type TemplateResult } from "lit";
import type { ConfiguredDevice } from "../../api/types/devices.js";
import { openTargetUrl } from "../../util/file-paths.js";

export interface LinkItem {
  label: string;
  /** Secondary text, e.g. the YAML file name under a friendly name. */
  detail?: string;
  /** App-relative URL to open; null renders a plain row. */
  url: string | null;
}

/** Rows for *configurations*, labelled with each device's friendly name. */
export function deviceItems(
  configurations: readonly string[],
  devices: readonly ConfiguredDevice[]
): LinkItem[] {
  const byConfiguration = new Map(devices.map((d) => [d.configuration, d]));
  return configurations.map((configuration) => {
    const device = byConfiguration.get(configuration);
    const label = device?.friendly_name || device?.name || configuration;
    return {
      label,
      detail: label === configuration ? undefined : configuration,
      url: `/device/${encodeURIComponent(configuration)}`,
    };
  });
}

/** Rows for *paths*; device YAMLs open the device editor. Absolute paths
 *  (includes outside the config dir) have no editor and stay plain. */
export function fileItems(paths: readonly string[]): LinkItem[] {
  return paths.map((path) => ({
    label: path,
    url: /^(\/|[a-z]:)/i.test(path) ? null : openTargetUrl(path),
  }));
}

export function renderLinkList(
  items: readonly LinkItem[],
  open: (url: string) => void
): TemplateResult | typeof nothing {
  if (items.length === 0) return nothing;
  return html`<ul class="link-list">
    ${items.map(
      (item) =>
        html`<li>
          ${
            item.url === null
              ? html`<span class="link-row"
                  ><span class="link-label">${item.label}</span></span
                >`
              : html`<button
                  type="button"
                  class="link-row"
                  @click=${() => open(item.url!)}
                >
                  <span class="link-label">${item.label}</span>
                  ${item.detail ? html`<span class="link-detail">${item.detail}</span>` : nothing}
                </button>`
          }
        </li>`
    )}
  </ul>`;
}

export const linkListStyles = css`
  .link-list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 320px;
    overflow-y: auto;
    border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
    border-radius: var(--wa-border-radius-m);
  }
  .link-list li + li {
    border-top: var(--wa-border-width-s) solid var(--wa-color-surface-border);
  }
  .link-row {
    display: flex;
    width: 100%;
    align-items: baseline;
    gap: var(--wa-space-s);
    padding: 8px 12px;
    border: none;
    background: transparent;
    font: inherit;
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-normal);
    text-align: left;
    box-sizing: border-box;
  }
  button.link-row {
    cursor: pointer;
  }
  button.link-row:hover,
  button.link-row:focus-visible {
    background: var(--wa-color-surface-lowered);
  }
  .link-label {
    overflow-wrap: anywhere;
  }
  .link-detail {
    margin-left: auto;
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
    white-space: nowrap;
  }
`;
