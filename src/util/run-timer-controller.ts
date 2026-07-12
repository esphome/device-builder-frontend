import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { FirmwareJob } from "../api/types/firmware-jobs.js";
import { isCompileEndLine, isCompilePhaseLine } from "./compile-phase.js";
import {
  getCompileTiming,
  markCompileEnded,
  markCompileStarted,
} from "./compile-timing.js";
import { parseIsoMs } from "./format-job-time.js";

export interface RunTimerOptions {
  /** The job the timer reports on — the live jobs-context entry when the host
   *  has one. Backs the total-run figure, the backend compile stamps, and the
   *  progress-gauge start signal. */
  job: () => FirmwareJob | undefined;
  /** Key for the cross-open timing store (the followed job's id). */
  jobId: () => string;
  /** Host-specific freeze backstop: the run is over even though no summary
   *  banner was seen (terminal command state / the install step left
   *  compiling). */
  runEnded: () => boolean;
  /** Whether the 1s ticker should run (host visible and the run live). */
  tick: () => boolean;
  /** Selector for the timer wrap in the host's render root; clicks inside it
   *  don't dismiss the detail popover. */
  popoverWrapSelector?: string;
}

/**
 * Reactive controller owning a build's run/compile clocks, shared by the
 * command dialog and the firmware-install dialog.
 *
 * The compile span (dependency download excluded; CMake configure counts) is
 * latched live from streamed log lines via ``noteLine`` plus the backend
 * progress gauge, mirrored to the cross-open store, and — on ``attach`` —
 * restored from the job's backend ``compile_started_at``/``compile_ended_at``
 * stamps first, so it survives reloads. A 1s ticker drives the live readouts
 * while ``tick()`` holds; it stops on freeze and on host disconnect. Also
 * owns the timer's detail popover open state with outside-click dismissal.
 */
export class RunTimerController implements ReactiveController {
  /** Clock behind the live readouts; ticks each second while the run is live. */
  now = Date.now();
  /** Whether the timer's detail popover is open. */
  showDetail = false;

  private _compileStartedAt: number | null = null;
  private _compileEndedAt: number | null = null;
  private _tickHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly _host: ReactiveControllerHost & Element,
    private readonly _options: RunTimerOptions
  ) {
    _host.addController(this);
  }

  hostUpdated(): void {
    // Second compile-start signal beside the log scanner: the backend's
    // progress gauge. It latches for raw ninja ([N/M]) builds but not for the
    // "Compiling <path>" pio output, so the two together cover every toolchain.
    if (this._compileStartedAt === null && this._options.job()?.progress != null) {
      this._markStarted();
    }
    // Backstop the freeze: if the run settles without a summary banner in the
    // stream, stop the clock at the terminal transition.
    if (
      this._compileStartedAt !== null &&
      this._compileEndedAt === null &&
      this._options.runEnded()
    ) {
      this._markEnded();
    }
    if (this._options.tick()) this._startTicker();
    else this._stopTicker();
  }

  hostDisconnected(): void {
    this._stopTicker();
    this.closeDetail();
  }

  /** Reset for a fresh run (the host's open path). */
  reset(): void {
    this._compileStartedAt = null;
    this._compileEndedAt = null;
    this.closeDetail();
  }

  /**
   * Restore the compile clock for *job* (the host's follow/reattach path).
   *
   * The backend stamps win — they survive a full page reload / reconnect —
   * and the in-memory store covers a same-session reopen before they land;
   * without either, the live line scan re-derives from the replayed stream.
   */
  attach(job: FirmwareJob): void {
    const timing = getCompileTiming(job.job_id);
    this._compileStartedAt =
      parseIsoMs(job.compile_started_at) ?? timing?.startedAt ?? null;
    this._compileEndedAt = parseIsoMs(job.compile_ended_at) ?? timing?.endedAt ?? null;
    this.closeDetail();
  }

  /** Latch the compile span off one streamed build-output line. */
  noteLine(line: string): void {
    if (this._compileStartedAt === null) {
      if (isCompilePhaseLine(line)) this._markStarted();
    } else if (this._compileEndedAt === null && isCompileEndLine(line)) {
      this._markEnded();
    }
  }

  // Live-detected compile span (frontend clock). Drives the inline offload
  // suggestion and the compile-time detail before the backend field lands.
  // Clamped so a backwards clock adjustment can't leak a negative duration
  // into threshold gating.
  get compileElapsedMs(): number | null {
    if (this._compileStartedAt === null) return null;
    return Math.max(0, (this._compileEndedAt ?? this.now) - this._compileStartedAt);
  }

  // True while the compile is actively running — drives the inline offload
  // suggestion (a finished compile hands the slot back to the reset hint).
  get isCompiling(): boolean {
    return this._compileStartedAt !== null && this._compileEndedAt === null;
  }

  // Whole-job wall time (queue excluded): download + compile + link, and for
  // an install the flash — the number PlatformIO prints as "Took". Freezes at
  // completion; null before the job starts running.
  get totalRunElapsedMs(): number | null {
    const job = this._options.job();
    const start = parseIsoMs(job?.started_at);
    if (start === null) return null;
    return Math.max(0, (parseIsoMs(job?.completed_at) ?? this.now) - start);
  }

  // Compile-only time for the detail popover, or null when it's unknown. Uses
  // the backend's stamps (same job clock as the total, so total >= compile
  // always holds once both are set). Without them it trusts live frontend
  // detection only while the run is still going — a finished job with no
  // stamps is an old build from before this feature, whose compile time we
  // genuinely can't recover from the replayed log, so it stays hidden.
  get compileDetailMs(): number | null {
    const job = this._options.job();
    const beStart = parseIsoMs(job?.compile_started_at);
    if (beStart !== null) {
      return Math.max(0, (parseIsoMs(job?.compile_ended_at) ?? this.now) - beStart);
    }
    return this.isRunFrozen ? null : this.compileElapsedMs;
  }

  // The run has settled (job terminal), so the timer freezes and stops pulsing.
  get isRunFrozen(): boolean {
    return parseIsoMs(this._options.job()?.completed_at) !== null;
  }

  toggleDetail = (): void => {
    if (this.showDetail) {
      this.closeDetail();
      return;
    }
    this.showDetail = true;
    // Dismiss on the next click anywhere outside the timer (the toolbar, the
    // log, elsewhere in the dialog). Capture-phase so it fires before other
    // handlers; registered after this opening click so it doesn't self-close.
    document.addEventListener("click", this._onOutsideClick, true);
    // Escape closes just the popover — capture-phase and claimed, so the
    // hosting dialog's own Escape handling doesn't also close the dialog.
    document.addEventListener("keydown", this._onEscape, true);
    this._host.requestUpdate();
  };

  closeDetail(): void {
    if (!this.showDetail) return;
    this.showDetail = false;
    document.removeEventListener("click", this._onOutsideClick, true);
    document.removeEventListener("keydown", this._onEscape, true);
    this._host.requestUpdate();
  }

  // Latch the compile start once, mirroring it to the cross-open timing store.
  private _markStarted(): void {
    if (this._compileStartedAt !== null) return;
    const now = Date.now();
    this._compileStartedAt = now;
    markCompileStarted(this._options.jobId(), now);
    this._host.requestUpdate();
  }

  // Freeze the compile end once, mirroring it to the cross-open timing store.
  private _markEnded(): void {
    if (this._compileStartedAt === null || this._compileEndedAt !== null) return;
    const now = Date.now();
    this._compileEndedAt = now;
    markCompileEnded(this._options.jobId(), now);
    this._host.requestUpdate();
  }

  private _onOutsideClick = (e: MouseEvent): void => {
    // The timer button toggles itself; only outside clicks close here.
    const wrap = this._options.popoverWrapSelector
      ? this._host.shadowRoot?.querySelector(this._options.popoverWrapSelector)
      : null;
    if (wrap && e.composedPath().includes(wrap)) return;
    this.closeDetail();
  };

  private _onEscape = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    this.closeDetail();
  };

  private _startTicker(): void {
    if (this._tickHandle !== null) return;
    this.now = Date.now();
    this._tickHandle = setInterval(() => {
      this.now = Date.now();
      this._host.requestUpdate();
    }, 1000);
  }

  private _stopTicker(): void {
    if (this._tickHandle === null) return;
    clearInterval(this._tickHandle);
    this._tickHandle = null;
  }
}
