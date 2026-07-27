import { css, html, type TemplateResult } from "lit";
import type { LocalizeFunc } from "../../common/localize.js";

/**
 * Fixed-position connection feedback the app shell overlays on the authed
 * layout: the indeterminate route-chunk loading bar and the reconnecting
 * pill. Kept beside ``router.ts`` so the shell's own file stays flat.
 */
export const connectionOverlayStyles = css`
  .route-loading-bar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    z-index: 10000;
    overflow: hidden;
    /* White-on-translucent so it stays visible over the branded
       (primary-colored) header the bar always overlays. */
    background: rgba(255, 255, 255, 0.25);
  }

  .route-loading-bar::after {
    content: "";
    position: absolute;
    inset: 0;
    width: 40%;
    background: #fff;
    box-shadow: 0 0 6px rgba(255, 255, 255, 0.7);
    animation: route-loading-slide 1.1s ease-in-out infinite;
  }

  @keyframes route-loading-slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(250%);
    }
  }

  .reconnect-pill {
    position: fixed;
    bottom: var(--wa-space-l);
    left: 50%;
    transform: translateX(-50%);
    z-index: 10000;
    padding: var(--wa-space-2xs) var(--wa-space-m);
    border-radius: 999px;
    background: var(--wa-color-warning-fill-loud, #b45309);
    color: var(--wa-color-warning-on-loud, #fff);
    font-size: var(--wa-font-size-s);
    box-shadow: var(--wa-shadow-m);
    animation: reconnect-fade-in 0.2s ease both;
    pointer-events: none;
  }

  @keyframes reconnect-fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
`;

/** Decorative feedback only — failures surface through the toast. */
export function renderRouteLoadingBar(): TemplateResult {
  return html`<div class="route-loading-bar" aria-hidden="true"></div>`;
}

export function renderReconnectPill(localize: LocalizeFunc): TemplateResult {
  return html`<div class="reconnect-pill" role="status">
    ${localize("layout.reconnecting")}
  </div>`;
}
