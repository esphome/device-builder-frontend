/**
 * Shared mount helper for the ``esphome-header-actions`` kebab-menu tests.
 *
 * The archived / search / check-updates suites each open the menu the same
 * way (construct, force ``_open``, append, settle) and differ only in the
 * gating prop they set first, so that boilerplate lives here rather than
 * getting copy-pasted per suite.
 */
import { ESPHomeHeaderActions } from "../../src/components/esphome-header-actions.js";

/**
 * Construct an open header-actions kebab menu with optional gating-prop
 * overrides applied, appended and settled. Pass public props by name
 * (``dashboardRoute``) or private state directly (``_desktopUpdateCapable``).
 */
export async function renderOpenHeaderMenu(
  overrides: Record<string, unknown> = {}
): Promise<ESPHomeHeaderActions> {
  const el = new ESPHomeHeaderActions();
  Object.assign(el, overrides);
  (el as unknown as { _open: boolean })._open = true;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}
