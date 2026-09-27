import type { ReactiveControllerHost } from "lit";

import type { LocalizeFunc } from "../../common/localize.js";
import { ESP_SERIAL_LOGS } from "../../platforms/esp/serial-logs.js";
import type { SerialLogsPolicy } from "../../platforms/serial-logs.js";
import { getErrorMessage } from "../../util/error-message.js";
import type { FlashPart } from "../platforms/esp/firmware-build.js";
import type { HandoffFlasher } from "./protocol.js";
import {
  RECEIVER_ENGINES,
  type ReceiverEngine,
  type ReceiverRun,
} from "./receiver-engine.js";

/** What is to be flashed, as it was handed over or picked. */
export interface PreparationInput {
  parts: FlashPart[];
  erase: boolean;
  flasher: HandoffFlasher;
}

export type PreparationState =
  | { kind: "idle" }
  | { kind: "pending" }
  /** Checked and ready: the run holds what it writes. */
  | { kind: "ready"; run: ReceiverRun }
  /** A chunk did not load; the input is kept to try again. */
  | { kind: "retryable"; input: PreparationInput };

type Outcome =
  { run: ReceiverRun; logs: SerialLogsPolicy } | { error: string; retryable: boolean };

/**
 * Gets an image ready to flash before the user clicks: loads the flasher's
 * engine and has it check the image. The port picker needs the click's user
 * activation, which does not outlast a chunk fetch on a slow network, so the
 * receiver offers the install only in the ``ready`` state and the click goes
 * straight to the picker. A bad image is also named before a port is asked
 * for.
 */
export class ReceiverPreparation {
  state: PreparationState = { kind: "idle" };
  /**
   * The serial logs policy of the flasher that was last prepared. It
   * outlives the state, for the logs of a flash that is already done.
   */
  logs: SerialLogsPolicy = ESP_SERIAL_LOGS;

  // Supersedes a preparation that a newer input, or a clear, overtook.
  private _generation = 0;

  constructor(
    private readonly _host: ReactiveControllerHost,
    private readonly _localize: () => LocalizeFunc,
    /** A preparation ended: with the reason it failed, or null when ready. */
    private readonly _onSettled: (error: string | null) => void
  ) {}

  /**
   * Prepare ``input``, or what it resolves to when it still has to be read (a
   * picked file); a read that fails rejects with the line to show.
   */
  start(input: PreparationInput | Promise<PreparationInput>): void {
    const generation = ++this._generation;
    this._set({ kind: "pending" });
    void this._settle(input).then(({ state, logs, error }) => {
      if (generation !== this._generation) return;
      if (logs) this.logs = logs;
      this._set(state);
      this._onSettled(error);
    });
  }

  private async _settle(pending: PreparationInput | Promise<PreparationInput>): Promise<{
    state: PreparationState;
    logs?: SerialLogsPolicy;
    error: string | null;
  }> {
    let input: PreparationInput;
    try {
      input = await pending;
    } catch (err) {
      return { state: { kind: "idle" }, error: getErrorMessage(err) };
    }
    const outcome = await this._prepare(input);
    if ("run" in outcome) {
      return {
        state: { kind: "ready", run: outcome.run },
        logs: outcome.logs,
        error: null,
      };
    }
    // An image that failed its check fails it again; only a load is retried.
    return {
      state: outcome.retryable ? { kind: "retryable", input } : { kind: "idle" },
      error: outcome.error,
    };
  }

  /** Run a preparation that a chunk failed to load for again. */
  retry(): void {
    if (this.state.kind === "retryable") this.start(this.state.input);
  }

  /** Drop what was prepared or under way (another file was picked). */
  clear(): void {
    this._generation++;
    this._set({ kind: "idle" });
  }

  private _set(state: PreparationState): void {
    this.state = state;
    this._host.requestUpdate();
  }

  private async _prepare(input: PreparationInput): Promise<Outcome> {
    const localize = this._localize();
    let engine: ReceiverEngine;
    try {
      engine = await RECEIVER_ENGINES[input.flasher]();
    } catch (err) {
      console.error("[flash receiver] Could not load the engine chunk:", err);
      return { error: localize("firmware.engine_load_failed"), retryable: true };
    }
    try {
      const plan = await engine.prepare(input.parts, input.erase, localize);
      if ("error" in plan)
        return { error: plan.error, retryable: plan.retryable === true };
      return { run: plan.run, logs: engine.logs };
    } catch (err) {
      // An engine broke its never-throws contract: name the image, not the network.
      console.error("[flash receiver] The engine could not check the image:", err);
      return {
        error: `${localize("web.flash.invalid_image")} (${getErrorMessage(err)})`,
        retryable: false,
      };
    }
  }
}
