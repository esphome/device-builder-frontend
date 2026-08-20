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
  const layoutBtn = (mode: DeviceLayoutMode, icon: string, key: string, cls = "") => {
    const label = p.localize(key);
    return html`<button
        id="btn-layout-${mode}"
        type="button"
        class="ghost-icon-btn ${cls}"
        aria-pressed=${p.effectiveLayout === mode}
        @click=${() => p.onSetLayout(mode)}
        aria-label=${label}
      >
        <wa-icon library="mdi" name=${icon}></wa-icon>
      </button>
      <wa-tooltip for="btn-layout-${mode}">${label}</wa-tooltip>`;
  };
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
      ${layoutBtn("left", "dock-left", "device.layout_components_only")}
      ${layoutBtn("both", "view-split-vertical", "device.layout_split", "split-btn")}
      ${layoutBtn("right", "dock-right", "device.layout_yaml_only")}
    </div>
  </div>`;
}
