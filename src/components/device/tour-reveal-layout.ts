import { effectiveDeviceLayout } from "../../util/editor-layout.js";
import type { DeviceLayoutMode } from "./device-editor.js";

/**
 * The layout that makes the tour anchor *id* visible, or null when it
 * already is (or the anchor isn't a layout-dependent pane).
 *
 * Mobile collapses "both" to the YAML pane, so revealing there means
 * switching to the single pane that holds the anchor; desktop reveals
 * by returning to the split view.
 */
export function layoutRevealingAnchor(
  id: string,
  layout: DeviceLayoutMode,
  isMobile: boolean
): DeviceLayoutMode | null {
  const effective = effectiveDeviceLayout(layout, isMobile);
  if (id === "central" && effective === "right") return isMobile ? "left" : "both";
  if (id === "yaml" && effective === "left") return isMobile ? "right" : "both";
  return null;
}
