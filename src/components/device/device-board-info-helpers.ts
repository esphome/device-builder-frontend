/**
 * Pure helpers for `device-board-info`. Extracted so the test
 * can import them without pulling in the webawesome
 * CSSStyleSheet polyfill that the component itself registers
 * eagerly (and which fails in a Node environment).
 */

/**
 * True when the YAML transitioned from "no content" (empty,
 * `undefined` initial, or `null`) to a non-empty value. Two
 * real cases qualify:
 *
 *   - First-time arrival on page load (the page's
 *     `_api.getConfig` resolved after the section editor was
 *     deep-linked). Without bypassing the debounce, the form
 *     would sit empty for a full coalesce window.
 *   - User cleared the YAML pane and pasted new content. The
 *     next input deserves immediate feedback — nothing to
 *     coalesce against.
 *
 * The debounce only earns its keep against rapid yaml
 * mutations (typing in the editor pane); these transitions
 * have no spam risk and a perceptible empty-form window if
 * gated.
 */
export function isEmptyToPopulatedYamlChange(
  prev: string | undefined | null,
  next: string
): boolean {
  return !prev && !!next;
}
