import { html, type TemplateResult } from "lit";
import type { LocalizeFunc } from "../../common/localize.js";

export interface FeatureItem {
  icon: string;
  titleKey: string;
  descKey: string;
}

/**
 * The remote-compute explainer items. Settings (appearance section) and the
 * onboarding wizard render this same list so the two always tell one story;
 * hosts register the icons and pair with ``featureListStyles``.
 */
export const REMOTE_COMPUTE_FEATURES: FeatureItem[] = [
  {
    icon: "server-network",
    titleKey: "settings.remote_compute_feature_dashboard",
    descKey: "settings.remote_compute_feature_dashboard_desc",
  },
  {
    icon: "memory",
    titleKey: "settings.remote_compute_feature_builder",
    descKey: "settings.remote_compute_feature_builder_desc",
  },
  {
    icon: "handshake",
    titleKey: "settings.remote_compute_feature_paired",
    descKey: "settings.remote_compute_feature_paired_desc",
  },
];

/** Icon + title + description rows; pair with ``featureListStyles``. */
export function renderFeatureList(
  localize: LocalizeFunc,
  features: FeatureItem[]
): TemplateResult {
  return html`
    <ul class="feature-list">
      ${features.map(
        (f) => html`
          <li class="feature-item">
            <wa-icon library="mdi" name=${f.icon}></wa-icon>
            <div class="feature-item-text">
              <span class="feature-item-title">${localize(f.titleKey)}</span>
              <span class="feature-item-desc">${localize(f.descKey)}</span>
            </div>
          </li>
        `
      )}
    </ul>
  `;
}
