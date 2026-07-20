/**
 * Section header (title row, docs link, subtitle, description, board
 * image) and the section-alerts danger banner.
 */
import { html, nothing } from "lit";
import { defaultBoardImageUrl, onBoardImageError } from "../../../util/board-image.js";
import { renderMarkdown } from "../../../util/markdown.js";
import type { ESPHomeDeviceSectionConfig } from "../device-section-config.js";
import type { SectionConfigResponse } from "./loading.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

export interface SectionHeaderOpts {
  config: SectionConfigResponse;
  catalogMiss: boolean;
  headerTitle: string;
  sectionAlerts: string[];
}

export function renderSectionHeader(
  host: ESPHomeDeviceSectionConfig,
  { config, catalogMiss, headerTitle, sectionAlerts }: SectionHeaderOpts
) {
  return html`
    <div class="section-header">
      <div class="section-header-info">
        <div class="section-header-title-row">
          <h3 class="section-title">${headerTitle}</h3>
          ${
            config.docs_url
              ? html`<a
                  class="docs-link"
                  href=${config.docs_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  ${host._localize("device.docs")}
                  <wa-icon library="mdi" name="open-in-new"></wa-icon>
                </a>`
              : nothing
          }
        </div>
        ${
          catalogMiss ? html`<p class="section-subtitle">${host.sectionKey}</p>` : nothing
        }
        ${
          config.description
            ? html`<p class="section-desc">${renderMarkdown(config.description)}</p>`
            : nothing
        }
      </div>
      ${
        catalogMiss
          ? nothing
          : html`<div class="section-image">
              <img
                src=${config.image_url || defaultBoardImageUrl()}
                alt=${config.title}
                referrerpolicy="no-referrer"
                @error=${onBoardImageError}
              />
            </div>`
      }
    </div>
    ${
      sectionAlerts.length > 0
        ? html`<div class="danger-banner section-error-banner" role="alert">
            <wa-icon library="mdi" name="alert-circle-outline"></wa-icon>
            <div class="danger-banner-text">
              ${sectionAlerts.map((msg) => html`<p>${msg}</p>`)}
            </div>
          </div>`
        : nothing
    }
  `;
}
