import type { ReactiveController, ReactiveControllerHost } from "lit";

/**
 * Repaints device cards as their offline duration advances.
 *
 * An offline device sends nothing, so a card showing a duration has to
 * repaint itself. ``NowTickController`` owns an interval per instance, which
 * across a card grid is dozens of timers doing identical work, so the cards
 * share one module-level interval that exists only while at least one of
 * them is showing a duration.
 */
const clocks = new Set<OfflineClockController>();
let timer: ReturnType<typeof setInterval> | null = null;

function tick(): void {
  for (const clock of clocks) clock.tick();
}

// The granularity ``formatDuration`` renders at: seconds under a minute,
// minutes after. A repaint inside the same step would draw the same label.
function shownStep(seconds: number): number {
  const whole = Math.max(0, Math.floor(seconds));
  return whole < 60 ? whole : whole - (whole % 60);
}

export class OfflineClockController implements ReactiveController {
  private readonly host: ReactiveControllerHost;
  private readonly seconds: () => number | null;
  private shown = 0;

  /** *seconds* is the duration the host is showing, ``null`` when it shows none. */
  constructor(host: ReactiveControllerHost, seconds: () => number | null) {
    this.host = host;
    this.seconds = seconds;
    host.addController(this);
  }

  hostConnected(): void {
    this.reconcile();
  }

  hostUpdated(): void {
    this.reconcile();
  }

  hostDisconnected(): void {
    this.leave();
  }

  tick(): void {
    const seconds = this.seconds();
    if (seconds !== null && shownStep(seconds) !== this.shown) this.host.requestUpdate();
  }

  private reconcile(): void {
    const seconds = this.seconds();
    if (seconds === null) {
      this.leave();
      return;
    }
    this.shown = shownStep(seconds);
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
