/**
 * Section header (title row, docs link, subtitle, description, board
 * image) and the section-alerts danger banner.
 */
import { html, nothing } from "lit";
import { defaultBoardImageUrl, onBoardImageError } from "../../../util/board-image.js";
import { isSafeLinkHref, renderMarkdown } from "../../../util/markdown.js";
import type { ESPHomeDeviceSectionConfig } from "../device-section-config.js";
import type { SectionConfigResponse } from "./loading.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

export function renderSectionHeader(
  host: ESPHomeDeviceSectionConfig,
  config: SectionConfigResponse,
  sectionAlerts: string[]
) {
  // A catalog miss (external component or bare platform domain) swaps the
  // title and drops the subtitle-less image header.
  const catalogMiss = host._isUnknown || host._isPlatformDomain;
  const headerTitle = host._isUnknown
    ? host._localize("device.external_component_title")
    : host._isPlatformDomain
      ? host._localize("device.platform_section_title")
      : config.title;
  return html`
    <div class="section-header">
      <div class="section-header-info">
        <div class="section-header-title-row">
          <h3 class="section-title">${headerTitle}</h3>
          ${
            isSafeLinkHref(config.docs_url)
              ? html`<a
                  class="docs-link"
                  href=${config.docs_url}
                  target="_blank"
                  rel="noopener noreferrer"
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
