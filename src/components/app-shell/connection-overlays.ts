import { css, html, type TemplateResult } from "lit";
import { ref } from "lit/directives/ref.js";
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
    pointer-events: none;
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
    /* Reset the UA popover centering (inset: 0 + margin: auto) so the
       fixed bottom-center placement below wins. */
    inset: auto;
    margin: 0;
    border: none;
    overflow: visible;
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

// Module-level so the ref callback keeps one identity across renders;
// an inline arrow would re-fire on every host render. The microtask
// defers past the commit: ref fires before Lit inserts the fragment,
// and showPopover() throws on a disconnected element.
function showPillOnAttach(el?: Element): void {
  if (!(el instanceof HTMLElement) || typeof el.showPopover !== "function") return;
  queueMicrotask(() => {
    if (el.isConnected && !el.matches(":popover-open")) el.showPopover();
  });
}

/**
 * A manual popover, not a plain fixed div: modal dialogs sit in the
 * browser top layer above any z-index. Shows itself on attach; DOM
 * removal hides it.
 */
export function renderReconnectPill(localize: LocalizeFunc): TemplateResult {
  return html`<div
    class="reconnect-pill"
    popover="manual"
    role="status"
    ${ref(showPillOnAttach)}
  >
    ${localize("layout.reconnecting")}
  </div>`;
}

/**
 * Timer gate for the reconnect pill: a blip shorter than the delay never
 * shows it (nor fires its ``role="status"`` announcement — a CSS delay
 * would still announce). Repeat disconnects while armed keep the first
 * outage's clock.
 */
export class ReconnectPillGate {
  private _timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly _delayMs: number,
    private readonly _onChange: (visible: boolean) => void
  ) {}

  disconnected(): void {
    this._timer ??= setTimeout(() => {
      this._timer = null;
      this._onChange(true);
    }, this._delayMs);
  }

  connected(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._onChange(false);
  }
}
