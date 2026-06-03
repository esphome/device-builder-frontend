import type { LocalizeFunc } from "../common/localize.js";

/**
 * Friendly label for a component action-list field key
 * (``open_action`` → "Open action").
 *
 * Component action fields are ``type: trigger`` config fields like the
 * cover ``feedback`` platform's ``open_action`` / ``close_action`` /
 * ``stop_action``. There's no backend label, so derive the name from the
 * key (drop the ``_action`` suffix, underscores → spaces, sentence-case)
 * and feed it to the ``device.action_field_label`` template so the
 * surrounding word and order localize. The stem itself is an English
 * schema identifier (like a component name) and stays as-is.
 */
export function actionFieldLabel(field: string, localize: LocalizeFunc): string {
  const base = field.endsWith("_action") ? field.slice(0, -"_action".length) : field;
  const words = base.replace(/_/g, " ").trim() || field;
  const name = words ? words[0].toUpperCase() + words.slice(1) : words;
  return localize("device.action_field_label", { name });
}
