/**
 * True when *el* is a text-entry surface a global key handler must not
 * steal from: form fields, contentEditable, or anything inside the YAML
 * editor (its focused element varies by CodeMirror version, so walk up
 * to the recognisable host).
 */
export function isTypingTarget(el: HTMLElement | undefined): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  let cur: Element | null = el;
  while (cur) {
    if (cur.tagName === "ESPHOME-YAML-EDITOR") return true;
    // Hop shadow boundaries — CodeMirror mounts inside the editor's root.
    const root = cur.getRootNode();
    cur = cur.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return false;
}
