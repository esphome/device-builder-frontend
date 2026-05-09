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
 * Legacy textarea + ``execCommand("copy")`` fallback.
 *
 * Pattern lifted from the proven ``copy-to-clipboard`` library:
 * ``position: absolute; left: -9999px`` (off-screen but still
 * laid out), simple ``.select()`` on a textarea, no
 * ``contentEditable`` / ``setSelectionRange`` flourishes that
 * sometimes interact badly with browser-specific focus quirks.
 * The earlier ``opacity: 0`` + ``position: fixed`` combination
 * caused the symptom the user reported: ``execCommand`` returned
 * ``true`` but the system clipboard ended up empty because some
 * browsers treat opacity-0 as not-rendered and silently break
 * the selection.
 *
 * Removes the element regardless of success / failure path.
 */
function copyViaExecCommand(text: string): boolean {
  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  let ok = false;
  try {
    textarea.select();
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  } finally {
    document.body.removeChild(textarea);
  }
  return ok;
}
