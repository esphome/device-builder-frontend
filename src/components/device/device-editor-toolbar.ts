import { html, nothing, type TemplateResult } from "lit";
import type { LocalizeFunc } from "../../common/localize.js";
import { tourAnchor } from "../guided-tour/tour-anchor.js";
import type { DeviceLayoutMode } from "./device-editor.js";
import { renderRevealSensitiveToggle } from "./reveal-sensitive-toggle.js";

import "@home-assistant/webawesome/dist/components/tooltip/tooltip.js";

export interface EditorToolbarProps {
  localize: LocalizeFunc;
  /** The layout actually in effect (mobile may collapse "both" → "right"). */
  effectiveLayout: DeviceLayoutMode;
  revealSensitive: boolean;
  showDiffButton: boolean;
  showDiff: boolean;
  yaml: string;
  savedYaml: string;
  onToggleRevealSensitive: () => void;
  onToggleDiff: () => void;
  onSetLayout: (layout: DeviceLayoutMode) => void;
}

/**
 * The editor header's right-hand action cluster: the reveal-sensitive toggle
 * (hidden in the components-only layout where no YAML is on screen), the
 * editor/diff toggle, and the three-way layout switch. Rendered into the
 * device-editor shadow root, so its `.header-actions` / `.layout-toggle`
 * styles apply.
 */
export function renderEditorToolbar(p: EditorToolbarProps): TemplateResult {
  return html`<div class="header-actions">
    ${
      p.effectiveLayout !== "left"
        ? renderRevealSensitiveToggle(
            p.localize,
            p.revealSensitive,
            p.onToggleRevealSensitive,
            "diff-toggle"
          )
        : nothing
    }
    ${
      p.showDiffButton
        ? (() => {
            const diffLabel = p.showDiff
              ? p.localize("device.diff_view_editor")
              : p.localize("device.diff_view_diff");
            return html`<button
                id="btn-diff-toggle"
                type="button"
                class="ghost-icon-btn diff-toggle"
                aria-pressed=${p.showDiff}
                ?disabled=${p.yaml === p.savedYaml && !p.showDiff}
                aria-label=${diffLabel}
                @click=${p.onToggleDiff}
              >
                <wa-icon library="mdi" name="file-compare"></wa-icon>
              </button>
              <wa-tooltip for="btn-diff-toggle">${diffLabel}</wa-tooltip>`;
          })()
        : nothing
    }
    <div
      class="layout-toggle"
      role="group"
      aria-label=${p.localize("device.editor_layout_label")}
      ${tourAnchor("layout-toggle")}
    >
      <button
        id="btn-layout-left"
        type="button"
        class="ghost-icon-btn"
        aria-pressed=${p.effectiveLayout === "left"}
        @click=${() => p.onSetLayout("left")}
        aria-label=${p.localize("device.layout_components_only")}
      >
        <wa-icon library="mdi" name="dock-left"></wa-icon>
      </button>
      <wa-tooltip for="btn-layout-left"
        >${p.localize("device.layout_components_only")}</wa-tooltip
      >
      <button
        id="btn-layout-split"
        class="ghost-icon-btn split-btn"
        type="button"
        aria-pressed=${p.effectiveLayout === "both"}
        @click=${() => p.onSetLayout("both")}
        aria-label=${p.localize("device.layout_split")}
      >
        <wa-icon library="mdi" name="view-split-vertical"></wa-icon>
      </button>
      <wa-tooltip for="btn-layout-split">${p.localize("device.layout_split")}</wa-tooltip>
      <button
        id="btn-layout-right"
        type="button"
        class="ghost-icon-btn"
        aria-pressed=${p.effectiveLayout === "right"}
        @click=${() => p.onSetLayout("right")}
        aria-label=${p.localize("device.layout_yaml_only")}
      >
        <wa-icon library="mdi" name="dock-right"></wa-icon>
      </button>
      <wa-tooltip for="btn-layout-right"
        >${p.localize("device.layout_yaml_only")}</wa-tooltip
      >
    </div>
  </div>`;
}
