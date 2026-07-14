import { html, nothing, type TemplateResult } from "lit";
import type { LocalizeFunc } from "../../common/localize.js";
import { tourAnchor } from "../guided-tour/tour-anchor.js";
import type { DeviceLayoutMode } from "./device-editor.js";

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
        ? (() => {
            const sensitiveLabel = p.localize(
              p.revealSensitive
                ? "device.yaml_mask_sensitive"
                : "device.yaml_reveal_sensitive"
            );
            return html`<button
              type="button"
              class="ghost-icon-btn diff-toggle"
              aria-pressed=${p.revealSensitive}
              aria-label=${sensitiveLabel}
              @click=${p.onToggleRevealSensitive}
              title=${sensitiveLabel}
            >
              <wa-icon
                library="mdi"
                name=${p.revealSensitive ? "eye-off" : "eye"}
              ></wa-icon>
            </button>`;
          })()
        : nothing
    }
    ${
      p.showDiffButton
        ? (() => {
            const diffLabel = p.showDiff
              ? p.localize("device.diff_view_editor")
              : p.localize("device.diff_view_diff");
            return html`<button
              type="button"
              class="ghost-icon-btn diff-toggle"
              aria-pressed=${p.showDiff}
              ?disabled=${p.yaml === p.savedYaml && !p.showDiff}
              aria-label=${diffLabel}
              @click=${p.onToggleDiff}
              title=${diffLabel}
            >
              <wa-icon library="mdi" name="file-compare"></wa-icon>
            </button>`;
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
        type="button"
        class="ghost-icon-btn"
        aria-pressed=${p.effectiveLayout === "left"}
        @click=${() => p.onSetLayout("left")}
        aria-label=${p.localize("device.layout_components_only")}
        title=${p.localize("device.layout_components_only")}
      >
        <wa-icon library="mdi" name="dock-left"></wa-icon>
      </button>
      <button
        class="ghost-icon-btn split-btn"
        type="button"
        aria-pressed=${p.effectiveLayout === "both"}
        @click=${() => p.onSetLayout("both")}
        aria-label=${p.localize("device.layout_split")}
        title=${p.localize("device.layout_split")}
      >
        <wa-icon library="mdi" name="view-split-vertical"></wa-icon>
      </button>
      <button
        type="button"
        class="ghost-icon-btn"
        aria-pressed=${p.effectiveLayout === "right"}
        @click=${() => p.onSetLayout("right")}
        aria-label=${p.localize("device.layout_yaml_only")}
        title=${p.localize("device.layout_yaml_only")}
      >
        <wa-icon library="mdi" name="dock-right"></wa-icon>
      </button>
    </div>
  </div>`;
}
