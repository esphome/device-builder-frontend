/**
 * Whether the element is rendered (connected, no display:none
 * ancestor). offsetParent is the fallback for engines without
 * checkVisibility; it is null for hidden elements, and non-null for
 * rendered descendants of positioned containers like dialogs.
 */
export function isVisible(el: HTMLElement): boolean {
  return el.isConnected && (el.checkVisibility?.() ?? el.offsetParent !== null);
}
