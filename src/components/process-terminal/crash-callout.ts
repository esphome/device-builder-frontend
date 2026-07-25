import { mdiAlertCircle } from "@mdi/js";
import { css, html, nothing, type TemplateResult } from "lit";
import type { LocalizeFunc } from "../../common/localize.js";
import type { CrashKind } from "../../util/crash-detector.js";
import { registerMdiIcons } from "../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

// Self-contained: a consumer that registers nothing still gets the icon.
registerMdiIcons({ "alert-circle": mdiAlertCircle });

/**
 * Crash-detected callout for the ``suggestion`` slot of a process
 * terminal, shared by the builder's logs dialog and ESPHome Web's.
 * ``action`` is the builder's "Report this crash" button; the web
 * dialog has no backend to decode or report, so it passes none.
 */
export function renderCrashCallout(
  localize: LocalizeFunc,
  kind: CrashKind | null,
  action?: TemplateResult
): TemplateResult | typeof nothing {
  if (kind === null) return nothing;
  return html`<div class="crash-callout" slot="suggestion">
    <wa-icon library="mdi" name="alert-circle" aria-hidden="true"></wa-icon>
    <!-- Live region on the text only: announcing the whole row would
         read any action button as part of a status message. -->
    <span class="crash-callout-text" role="status"
      >${localize(
        kind === "previous-boot"
          ? "crash_report.banner_previous_boot"
          : "crash_report.banner"
      )}</span
    >
    ${action ?? nothing}
  </div>`;
}

/**
 * Re-pin the terminal after the callout first appears: it shrinks the log
 * container, which would otherwise push the crash tail out of view.
 */
export function repinTerminalForCallout(
  updateComplete: Promise<unknown>,
  terminal: () => { scrollToBottom(): void } | undefined
): void {
  void updateComplete
    .then(() => terminal()?.scrollToBottom())
    .catch((err) => console.warn("crash callout re-pin scroll failed", err));
}

/** Container shape only; an action button styles itself per consumer. */
export const crashCalloutStyles = css`
  .crash-callout {
    display: flex;
    align-items: center;
    gap: var(--wa-space-s);
    padding: 8px 20px;
    border-top: 1px solid var(--term-border);
    background: color-mix(in srgb, var(--esphome-error, #d32f2f) 14%, var(--term-bg));
    color: var(--term-fg);
    font-size: var(--wa-font-size-s);
  }

  .crash-callout wa-icon {
    flex-shrink: 0;
    color: var(--esphome-error, #d32f2f);
  }

  .crash-callout-text {
    flex: 1;
  }
`;
