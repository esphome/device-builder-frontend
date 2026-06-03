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
  // ``|| "action"`` keeps ``words`` non-empty (a bare ``_action`` key the
  // parser can't actually produce, or an empty field), so the
  // sentence-case below is always safe — no dead empty-string branch.
  const words = (base || field).replace(/_/g, " ").trim() || "action";
  const name = words[0].toUpperCase() + words.slice(1);
  return localize("device.action_field_label", { name });
}
