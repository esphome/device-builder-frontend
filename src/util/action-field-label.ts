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
  // A nested field is a dotted path (``valves.0.run_duration_number.
  // set_action``); the leaf segment names the action list.
  const segments = field.split(".");
  const leaf = segments[segments.length - 1] || field;
  const base = leaf.endsWith("_action") ? leaf.slice(0, -"_action".length) : leaf;
  // ``|| "action"`` keeps ``words`` non-empty (a bare ``_action`` key the
  // parser can't actually produce, or an empty field), so the
  // sentence-case below is always safe — no dead empty-string branch.
  const words = (base || leaf).replace(/_/g, " ").trim() || "action";
  const name = words[0].toUpperCase() + words.slice(1);
  return localize("device.action_field_label", { name });
}
