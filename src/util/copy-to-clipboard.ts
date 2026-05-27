/**
 * Cross-context "copy text to clipboard" helper.
 *
 * The modern ``navigator.clipboard.writeText`` API requires a
 * "secure context" per the Async Clipboard spec. Secure contexts
 * include HTTPS, ``http://localhost``, ``http://127.0.0.1``, and
 * file URLs — but NOT ``http://homeassistant.local:6052`` or
 * ``http://192.168.x.x:6052``, which is how the dashboard is
 * commonly reached on the HA-addon-direct-port and container
 * deployment shapes. On those origins ``navigator.clipboard``
 * is undefined (or ``writeText`` throws ``NotAllowedError``),
 * making any "Copy" button silently no-op.
 *
 * Same secure-context restriction applies to ``crypto.subtle``
 * — anywhere the dashboard needs to hash without a secure
 * context, the helper has to fall back to a userland
 * implementation. The clipboard problem is the UI-layer
 * counterpart of that constraint.
 *
 * Fallback: a hidden ``<span>`` containing the text + the
 * Selection API range-select + a one-shot ``copy`` event
 * listener that overrides ``clipboardData`` directly.
 * ``execCommand("copy")`` triggers the chain. Deprecated but
 * still implemented in every browser the dashboard supports;
 * works regardless of secure-context status because it goes
 * through the same code path as a manual user-initiated copy
 * from a selected text range. We use ``<span>`` rather than
 * ``<textarea>`` so an inherited ``user-select: none`` from
 * the dialog tree doesn't silently break the selection — see
 * ``copyViaExecCommand``'s docstring for the load-bearing
 * details.
 *
 * Returns ``true`` on success, ``false`` if both paths failed
 * (e.g. user has clipboard access denied at the browser level,
 * or the document is in an iframe without ``allow="clipboard-
 * write"``). Callers are expected to surface a toast in either
 * case.
 */

/**
 * Copy *text* to the user's clipboard, returning whether the
 * copy succeeded.
 *
 * **Order matters.** Tries ``execCommand("copy")`` FIRST
 * (synchronous, preserves the user-gesture token from the
 * click handler that called us), falls back to
 * ``navigator.clipboard.writeText`` only if that path failed.
 * The reverse order — try the async API first, fall back to
 * execCommand on failure — looks cleaner but loses the gesture
 * token across the ``await``: by the time the async API
 * rejects, ``execCommand("copy")`` returns ``true`` but
 * doesn't actually write anything in some browsers (Chromium
 * on plain-HTTP, notably). Going synchronous-first matches
 * the pattern in the popular ``copy-to-clipboard`` library
 * (4M+ downloads/week) and is what makes this work uniformly
 * across the dashboard's deployment shapes.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (copyViaExecCommand(text)) return true;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Both paths failed — caller surfaces the error toast.
    }
  }
  return false;
}

/**
 * Legacy ``execCommand("copy")`` fallback using a ``<span>`` +
 * Selection API.
 *
 * Pattern lifted from the proven ``copy-to-clipboard`` library
 * (4M+ weekly downloads). A textarea with ``select()`` works
 * sometimes but fails in subtle ways across browsers — earlier
 * versions of this helper used a textarea and ``execCommand``
 * returned ``true`` while the system clipboard ended up empty
 * on Firefox + Chromium when the dashboard was reached on
 * ``http://0.0.0.0:6052`` (non-secure context where
 * ``navigator.clipboard.writeText`` rejects, leaving execCommand
 * as the only path).
 *
 * The span + Selection API approach sidesteps the textarea
 * focus dance entirely — we create a span with the text as
 * its content, range-select its contents into the document
 * Selection, then fire ``execCommand("copy")``. The browser's
 * native copy path reads from the active Selection and
 * faithfully copies the text. ``style.all = unset`` is
 * critical: the Settings dialog inherits ``user-select: none``
 * for parts of its tree, and a default-styled span would
 * inherit that and silently fail to be selectable.
 *
 * ``clip: rect(0, 0, 0, 0)`` hides the span without taking it
 * out of layout (which ``opacity: 0`` and ``display: none``
 * both do, breaking selection). Removes the element + restores
 * the previous selection regardless of success.
 */
function copyViaExecCommand(text: string): boolean {
  if (typeof document === "undefined") return false;

  // Belt-and-braces approach: also hook the ``copy`` event and
  // override its ``clipboardData`` with our text. Selection-
  // based copy is brittle when a ``<dialog>`` element is open
  // (the dialog's focus trap can suppress the document-level
  // selection that ``execCommand("copy")`` reads from), AND
  // when shadow-DOM-rooted user-select rules collide with the
  // light-DOM target. The event-listener fallback ensures the
  // text lands on the clipboard even when the selection
  // mechanism silently failed. Pattern from the
  // ``copy-to-clipboard`` library (4M+ downloads/week).
  //
  // ``preventDefault`` only fires when ``clipboardData`` is
  // present AND we successfully set the override; in browsers
  // where ``clipboardData`` is null on the copy event, falling
  // through to the browser's default selection-based copy is
  // strictly better than blocking it.
  const onCopy = (e: ClipboardEvent) => {
    if (e.clipboardData) {
      e.clipboardData.setData("text/plain", text);
      e.preventDefault();
      e.stopPropagation();
    }
  };
  document.addEventListener("copy", onCopy);

  const selection = document.getSelection();
  // Capture any current selection so we can restore it after
  // our hijacked range. Cheap to be a good citizen — the user
  // might have text selected before clicking Copy.
  const previousRange =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;

  // ``execCommand("copy")`` won't fire the ``copy`` event
  // without an active non-empty selection. Use a hidden span
  // with the same text as content so the selection is
  // realistic (works even if the event listener isn't honored
  // for some reason). ``clip: rect(0, 0, 0, 0)`` hides without
  // taking the element out of layout (``opacity: 0`` /
  // ``display: none`` both break selection in some browsers).
  // ``style.all = "unset"`` strips inherited ``user-select:
  // none`` from any ancestor that might be in our path.
  const span = document.createElement("span");
  span.textContent = text;
  span.setAttribute("aria-hidden", "true");
  span.style.all = "unset";
  span.style.position = "fixed";
  span.style.top = "0";
  span.style.clip = "rect(0, 0, 0, 0)";
  span.style.whiteSpace = "pre";
  span.style.userSelect = "text";
  document.body.appendChild(span);

  let ok = false;
  try {
    const range = document.createRange();
    range.selectNodeContents(span);
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  } finally {
    document.removeEventListener("copy", onCopy);
    document.body.removeChild(span);
    if (selection) {
      selection.removeAllRanges();
      if (previousRange) selection.addRange(previousRange);
    }
  }
  return ok;
}
