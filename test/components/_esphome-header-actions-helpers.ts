/**
 * Shared mount helper for the ``esphome-header-actions`` kebab-menu tests.
 *
 * The archived / search / check-updates suites each open the menu the same
 * way (construct, force ``_open``, append, settle) and differ only in the
 * gating prop they set first, so that boilerplate lives here rather than
 * getting copy-pasted per suite.
 */
import type { LocalizeFunc } from "../../src/common/localize.js";
import { ESPHomeHeaderActions } from "../../src/components/esphome-header-actions.js";

/**
 * Gating flags the kebab-menu suites toggle before opening the menu — the
 * public ``dashboardRoute`` prop and the private ``_desktopUpdateCapable``
 * state, plus a ``_localize`` stub for suites asserting localized copy.
 * Narrowly typed (rather than ``Record<string, unknown>``) so a typo in a
 * gate name is a compile error; extend it as new suites need more gates.
 */
export interface HeaderMenuOverrides {
  dashboardRoute?: boolean;
  _desktopUpdateCapable?: boolean;
  _localize?: LocalizeFunc;
}

/**
 * Construct an open header-actions kebab menu with optional gating-prop
 * overrides applied, appended and settled.
 */
export async function renderOpenHeaderMenu(
  overrides: HeaderMenuOverrides = {}
): Promise<ESPHomeHeaderActions> {
  const el = new ESPHomeHeaderActions();
  Object.assign(el, overrides);
  (el as unknown as { _open: boolean })._open = true;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}
