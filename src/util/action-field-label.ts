/**
 * Friendly label for a component action-list field key
 * (``open_action`` → "Open action").
 *
 * Component action fields are ``type: trigger`` config fields like the
 * cover ``feedback`` platform's ``open_action`` / ``close_action`` /
 * ``stop_action``. There's no backend label for them, so derive one
 * from the key: drop the ``_action`` suffix, replace underscores with
 * spaces, sentence-case it, and re-append " action". Unknown ``*_action``
 * fields humanise the same way, so no per-field catalog is needed.
 */
export function actionFieldLabel(field: string): string {
  const base = field.endsWith("_action") ? field.slice(0, -"_action".length) : field;
  const words = base.replace(/_/g, " ").trim();
  const sentence = words ? words[0].toUpperCase() + words.slice(1) : words;
  return sentence ? `${sentence} action` : "Action";
}
