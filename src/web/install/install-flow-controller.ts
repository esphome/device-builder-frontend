import type { ReactiveController, ReactiveControllerHost } from "lit";

import { runFlash, type FlashPlan, type FlashStep } from "./run-flash.js";

/**
 * Drives a single flash operation for an install dialog and exposes the
 * reactive state its render reads. Wraps ``runFlash`` so the dialog stays
 * declarative: call ``start(port, plan)`` and render from the ``step`` /
 * ``progress`` / ``errorMessage`` / ``logLines`` fields plus the
 * ``busy`` / ``done`` / ``errored`` getters. The human-readable status text is
 * derived from ``step`` in ``install-progress.ts``, not stored here.
 */
export class InstallFlowController implements ReactiveController {
  step: FlashStep | "idle" = "idle";
  progress: number | null = null;
  errorMessage = "";
  logLines: string[] = [];

  constructor(private readonly host: ReactiveControllerHost) {
    host.addController(this);
  }

  hostDisconnected(): void {
    // Nothing to tear down: the flash owns the port and releases it on
    // completion/failure inside ``runFlash``. A dialog closed mid-flash is
    // gated by the busy flag, so this won't fire during an active write.
  }

  /** True while a flash is in flight (dialog should stay busy / non-dismissable). */
  get busy(): boolean {
    return (
      this.step === "connecting" ||
      this.step === "preparing" ||
      this.step === "erasing" ||
      this.step === "flashing"
    );
  }

  get done(): boolean {
    return this.step === "done";
  }

  get errored(): boolean {
    return this.step === "error";
  }

  reset(): void {
    this.step = "idle";
    this.progress = null;
    this.errorMessage = "";
    this.logLines = [];
    this.host.requestUpdate();
  }

  /** Run the plan; resolves to the ``runFlash`` success flag. */
  async start(port: SerialPort, plan: FlashPlan): Promise<boolean> {
    this.reset();
    return runFlash(port, plan, {
      onStep: (step) => {
        this.step = step;
        this.host.requestUpdate();
      },
      onProgress: (percent) => {
        this.progress = percent;
        this.host.requestUpdate();
      },
      onLog: (line) => {
        this.logLines = [...this.logLines, line];
        this.host.requestUpdate();
      },
      onError: (message) => {
        this.errorMessage = message;
        this.host.requestUpdate();
      },
    });
  }
}
