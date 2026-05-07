import { CORE_CATEGORIES, type ComponentCategory } from "../../api/types.js";

/**
 * Decide which categories to *exclude* from the catalog query
 * for the given dialog mode. Lives in its own module so the
 * three-mode contract can be unit-tested without spinning up a
 * DOM env to render the dialog.
 *
 * Three states the caller passes:
 *
 * - **Core-config dialog** (``isCoreLocked = true``). The
 *   "Add core configuration" entry point already locks the
 *   query *to* ``CORE_CATEGORIES``; excluding them too would
 *   produce an empty catalog. Returns ``[]``.
 * - **Dep-detour mode** (``isInDepDetour = true``). The form
 *   just told the user "you need a top-level <domain> first"
 *   and forwarded them back to the catalog filtered to that
 *   domain. The missing dep is sometimes itself a core block
 *   (e.g. a ``sensor.debug`` needs the bare ``debug:`` block
 *   whose catalog entry is ``core.debug``); hiding it from
 *   the very search the form drove the user to was the bug
 *   behind device-builder#383. Returns ``[]`` so core entries
 *   surface in the dep search.
 * - **Regular browse** (everything else). Hide ``core`` /
 *   ``ota`` / ``update`` so the user goes through the
 *   dedicated "Add core configuration" entry point for those
 *   instead of seeing them mixed into a sensor / output / etc.
 *   browse. Returns ``CORE_CATEGORIES``.
 */
export function chooseExcludeCategories(opts: {
  isCoreLocked: boolean;
  isInDepDetour: boolean;
}): readonly ComponentCategory[] {
  if (opts.isCoreLocked || opts.isInDepDetour) return [];
  return CORE_CATEGORIES;
}
