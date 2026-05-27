// Splits a localized template string by a sequence of placeholder tokens.
// Renderers that interleave Lit elements between static template chunks use
// this to turn e.g. "Try {clean_action} first then {reset_action}." into
// ["Try ", " first then ", "."], so each chunk can be interpolated next to
// the matching button/element.
//
// The returned array always has `placeholders.length + 1` entries; any
// placeholder absent from the template yields an empty string in its slot
// and the remainder stays trailing, matching the existing call sites'
// pair-of-split-with-default-empty pattern.
export function splitTemplate(template: string, ...placeholders: string[]): string[] {
  let rest = template;
  const parts: string[] = [];
  for (const placeholder of placeholders) {
    const [head, tail = ""] = rest.split(placeholder);
    parts.push(head);
    rest = tail;
  }
  parts.push(rest);
  return parts;
}
