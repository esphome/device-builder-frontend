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
 * (which is why ``src/util/remote-build-bearer.ts`` uses
 * ``js-sha256`` for hashing). The clipboard problem is the
 * UI-layer counterpart.
 *
 * Fallback: create a hidden ``<textarea>`` containing the text,
 * select it, fire ``document.execCommand("copy")``, remove the
 * textarea. Deprecated but still implemented in every browser
 * the dashboard supports — and unlike the modern API it works
 * regardless of secure-context status because it goes through
 * the same code path as a manual user-initiated copy from a
 * selected text range.
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
 * Tries ``navigator.clipboard.writeText`` first (works in secure
 * contexts and in HA-addon ingress where the upstream proxy
 * negotiates HTTPS); falls back to a temporary ``<textarea>`` +
 * ``execCommand("copy")`` for plain-HTTP origins where the
 * modern API is unavailable. Suppresses thrown errors from
 * either path so the caller's toast logic can run on a single
 * ``false`` return.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // ``NotAllowedError`` (non-secure context) and other
      // failures fall through to the legacy path. We don't
      // distinguish — both indicate the modern API is
      // unusable here and the fallback is the user's only
      // remaining option.
    }
  }
  return copyViaExecCommand(text);
}

/**
 * Legacy textarea + ``execCommand("copy")`` fallback.
 *
 * Several traps to avoid here, learned from the broken first
 * implementation that returned ``true`` from ``execCommand``
 * but didn't actually put text on the clipboard:
 *
 * * **Off-screen positioning, NOT ``opacity: 0``.** Some
 *   browsers treat ``opacity: 0`` as "not rendered" and
 *   silently break the selection range, after which
 *   ``execCommand("copy")`` returns ``true`` but copies
 *   nothing. Negative left + ``position: fixed`` keeps the
 *   textarea rendered (so selection works) but invisible.
 *
 * * **Explicit ``setSelectionRange``** on top of ``select()``.
 *   Some browsers (notably mobile Safari) ignore ``.select()``
 *   on a textarea with ``readonly``; the explicit range form
 *   works around this.
 *
 * * **Save and restore focus.** The click handler that called
 *   us had a focused element (the Copy button); the textarea
 *   focus we steal is brief, but skipping the restore would
 *   leave focus orphaned on the now-removed textarea.
 *
 * Removes the element regardless of success / failure path.
 */
function copyViaExecCommand(text: string): boolean {
  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  // ``readonly`` keeps mobile keyboards from popping up
  // during the brief moment the textarea is focused.
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  // Off-screen rather than opacity-0: see header comment.
  textarea.style.left = "-9999px";
  textarea.style.fontSize = "12pt";
  const previouslyFocused = document.activeElement as HTMLElement | null;
  document.body.appendChild(textarea);
  let ok = false;
  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  } finally {
    document.body.removeChild(textarea);
    previouslyFocused?.focus?.();
  }
  return ok;
}
