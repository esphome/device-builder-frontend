import type { ReactiveController, ReactiveControllerHost } from "lit";
import { type FirmwareJob, JobType } from "../api/types/firmware-jobs.js";
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
 * while ``tick()`` holds; it stops on freeze and on host disconnect.
 */
export class RunTimerController implements ReactiveController {
  /** Clock behind the live readouts; ticks each second while the run is live. */
  now = Date.now();

  private _compileStartedAt: number | null = null;
  private _compileEndedAt: number | null = null;
  private _tickHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly _host: ReactiveControllerHost,
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
  }

  /** Reset for a fresh run (the host's open path). */
  reset(): void {
    this._compileStartedAt = null;
    this._compileEndedAt = null;
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
      const beEnd = parseIsoMs(job?.compile_ended_at);
      if (beEnd !== null) return Math.max(0, beEnd - beStart);
      // Old backends never stamp an ESP-IDF build's end; for a pure COMPILE
      // job completion bounds the compile, so substitute completed_at rather
      // than ``now`` — the ticker stopped whenever the dialog last closed,
      // and a stale ``now`` before the start stamp clamps the readout to 0s.
      // An INSTALL keeps flashing after the compile, so its completion would
      // fold the flash into the readout — degrade to unknown instead.
      const end =
        job?.job_type === JobType.COMPILE ? parseIsoMs(job?.completed_at) : null;
      if (end !== null) return Math.max(0, end - beStart);
      return this.isRunFrozen ? null : Math.max(0, this.now - beStart);
    }
    return this.isRunFrozen ? null : this.compileElapsedMs;
  }

  // The run has settled (job terminal), so the timer freezes and stops pulsing.
  get isRunFrozen(): boolean {
    return parseIsoMs(this._options.job()?.completed_at) !== null;
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
