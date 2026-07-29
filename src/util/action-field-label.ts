import type { LocalizeFunc } from "../common/localize.js";

import { splitActionFieldPath } from "./action-field-path.js";

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
 *
 * A nested field's containers prefix the label so sibling fields with
 * the same leaf stay distinct (``repeat_number.set_action`` →
 * "Repeat number → Set action"); a list index folds into its container
 * (``valves.0.…`` → "Valves #1 → …"), matching the backend's parse
 * labels.
 */
export function actionFieldLabel(field: string, localize: LocalizeFunc): string {
  const segments = splitActionFieldPath(field);
  const leaf = String(segments[segments.length - 1] ?? field);
  const containers: string[] = [];
  for (const seg of segments.slice(0, -1)) {
    if (typeof seg === "number") {
      // A field path always starts with a schema key, so an index has a
      // container to fold into; an index-first path can't occur.
      containers[containers.length - 1] =
        `${containers[containers.length - 1]} #${seg + 1}`;
    } else {
      containers.push(humanize(seg));
    }
  }
  const base = leaf.endsWith("_action") ? leaf.slice(0, -"_action".length) : leaf;
  const name = humanize(base || leaf) || "Action";
  const leafLabel = localize("device.action_field_label", { name });
  return [...containers, leafLabel].join(" → ");
}

/** Sentence-case a schema key: underscores → spaces, first letter up. */
function humanize(key: string): string {
  const words = key.replace(/_/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}
