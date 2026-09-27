import type { ReactiveControllerHost } from "lit";

import type { LocalizeFunc } from "../../common/localize.js";
import { ESP_SERIAL_LOGS } from "../../platforms/esp/serial-logs.js";
import type { SerialLogsPolicy } from "../../platforms/serial-logs.js";
import { getErrorMessage } from "../../util/error-message.js";
import type { FlashPart } from "../platforms/esp/firmware-build.js";
import type { HandoffFlasher } from "./protocol.js";
import { RECEIVER_ENGINES, type ReceiverRun } from "./receiver-engine.js";

/** What is to be flashed, as it was handed over or picked. */
export interface PreparationInput {
  parts: FlashPart[];
  erase: boolean;
  flasher: HandoffFlasher;
}

/**
 * Gets an image ready to flash before the user clicks: loads the flasher's
 * engine and has it check the image. The port picker needs the click's user
 * activation, which does not outlast a chunk fetch on a slow network, so the
 * receiver offers the install only while ``run`` is set and the click goes
 * straight to the picker. A bad image is also named before a port is asked
 * for.
 */
export class ReceiverPreparation {
  /** The checked image's run; null until a preparation has succeeded. */
  run: ReceiverRun | null = null;
  /** A preparation is under way. */
  pending = false;
  /** The serial logs policy of the flasher that was last prepared. */
  logs: SerialLogsPolicy = ESP_SERIAL_LOGS;

  // Kept until a preparation has succeeded, so one that failed (a chunk that
  // did not load) can run again; the run holds the bytes after that.
  private _input: PreparationInput | null = null;
  // Supersedes a preparation that a newer input overtook.
  private _generation = 0;

  constructor(
    private readonly _host: ReactiveControllerHost,
    private readonly _localize: () => LocalizeFunc,
    /** A preparation ended: with the reason it failed, or null when ready. */
    private readonly _onSettled: (error: string | null) => void
  ) {}

  /** There is a failed preparation to run again. */
  get canRetry(): boolean {
    return this._input !== null && !this.pending;
  }

  start(input: PreparationInput): void {
    this._input = input;
    this.retry();
  }

  /** Drop what was prepared (the picked file was cleared). */
  clear(): void {
    this._generation++;
    this._input = null;
    this.run = null;
    this.pending = false;
    this._host.requestUpdate();
  }

  retry(): void {
    const input = this._input;
    if (!input) return;
    const generation = ++this._generation;
    this.run = null;
    this.pending = true;
    this._host.requestUpdate();
    void this._prepare(input).then((error) => {
      if (generation !== this._generation) return;
      this.pending = false;
      if (error === null) this._input = null;
      this._host.requestUpdate();
      this._onSettled(error);
    });
  }

  /** Resolves the reason the preparation failed, or null with ``run`` set. */
  private async _prepare(input: PreparationInput): Promise<string | null> {
    const localize = this._localize();
    let engine;
    try {
      engine = await RECEIVER_ENGINES[input.flasher]();
    } catch (err) {
      console.error("[flash receiver] Could not load the engine chunk:", err);
      return localize("firmware.engine_load_failed");
    }
    try {
      const plan = await engine.prepare(input.parts, input.erase, localize);
      if ("error" in plan) return plan.error;
      this.logs = engine.logs;
      this.run = plan.run;
      return null;
    } catch (err) {
      // An engine broke its never-throws contract: name the image, not the network.
      console.error("[flash receiver] The engine could not check the image:", err);
      return `${localize("web.flash.invalid_image")} (${getErrorMessage(err)})`;
    }
  }
}
