import type { ReactiveController, ReactiveControllerHost } from "lit";

/**
 * A one-second repaint shared by every surface showing an offline duration.
 *
 * The duration advances with wall-clock rather than with any incoming event
 * — an offline device sends nothing — so the surfaces showing one have to
 * repaint themselves. A timer per card would be dozens of intervals doing
 * identical work, and ticking the dashboard would re-render the whole page
 * each second, so hosts share one module-level interval that exists only
 * while at least one of them is actually displaying a duration.
 */
const hosts = new Set<ReactiveControllerHost>();
let timer: ReturnType<typeof setInterval> | null = null;

function tick(): void {
  for (const host of hosts) host.requestUpdate();
}

export class OfflineClockController implements ReactiveController {
  private readonly host: ReactiveControllerHost;

  constructor(host: ReactiveControllerHost) {
    this.host = host;
    host.addController(this);
  }

  hostDisconnected(): void {
    this.sync(false);
  }

  /** Join or leave the shared tick; *showing* is whether a duration is on screen. */
  sync(showing: boolean): void {
    if (showing) {
      hosts.add(this.host);
      timer ??= setInterval(tick, 1000);
      return;
    }
    hosts.delete(this.host);
    if (hosts.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }
}
