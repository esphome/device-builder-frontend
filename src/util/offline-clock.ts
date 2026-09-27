import type { ReactiveController, ReactiveControllerHost } from "lit";

// One shared interval, not ``NowTickController``'s one per instance, since
// a card grid can hold dozens.
const clocks = new Set<OfflineClockController>();
let timer: ReturnType<typeof setInterval> | null = null;

function tick(): void {
  for (const clock of clocks) clock.tick();
}

/**
 * Repaints a host when its offline label changes; an offline device sends
 * no events to do it.
 */
export class OfflineClockController implements ReactiveController {
  private readonly host: ReactiveControllerHost;
  private readonly label: () => string | null;
  private shown: string | null = null;
  private connected = false;

  /** *label* returns the label the host shows, ``null`` when it shows none. */
  constructor(host: ReactiveControllerHost, label: () => string | null) {
    this.host = host;
    this.label = label;
    host.addController(this);
  }

  hostConnected(): void {
    this.connected = true;
    this.reconcile();
  }

  hostUpdated(): void {
    this.reconcile();
  }

  hostDisconnected(): void {
    this.connected = false;
    this.leave();
  }

  tick(): void {
    const label = this.label();
    if (label !== null && label !== this.shown) this.host.requestUpdate();
  }

  private reconcile(): void {
    // An update pending at disconnect still runs; it must not rejoin.
    const label = this.connected ? this.label() : null;
    if (label === null) {
      this.leave();
      return;
    }
    this.shown = label;
    clocks.add(this);
    timer ??= setInterval(tick, 1000);
  }

  private leave(): void {
    clocks.delete(this);
    if (clocks.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }
}
