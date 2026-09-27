import type { ReactiveController, ReactiveControllerHost } from "lit";

/**
 * Repaints hosts showing an offline duration; an offline device sends no
 * events to do it. One shared interval, not ``NowTickController``'s one
 * per instance, since a card grid can hold dozens.
 */
const clocks = new Set<OfflineClockController>();
let timer: ReturnType<typeof setInterval> | null = null;

function tick(): void {
  for (const clock of clocks) clock.tick();
}

// ``formatDuration``'s granularity; the label is the same within a step.
// Hourly until 366 days, since a year spanning a leap day is that long.
function shownStep(seconds: number): number {
  const whole = Math.max(0, Math.floor(seconds));
  const unit = whole < 60 ? 1 : whole < 86400 ? 60 : whole < 366 * 86400 ? 3600 : 86400;
  return whole - (whole % unit);
}

export class OfflineClockController implements ReactiveController {
  private readonly host: ReactiveControllerHost;
  private readonly seconds: () => number | null;
  private shown = 0;

  /** *seconds* returns the shown duration, ``null`` when none. */
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
