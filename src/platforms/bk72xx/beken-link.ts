/**
 * The wire of a Beken download session: a command out, its response back,
 * and the LinkCheck loop that catches the chip's downloader. The response
 * reader follows bk7231tools: it looks for the next response header, skips
 * one that does not fit the command, and checks what the chip echoes.
 */
import { SerialByteSession } from "../../util/serial-byte-session.js";
import { sleep } from "../../util/sleep.js";
import {
  type BekenCommand,
  COMMAND_PREAMBLE,
  encodeCommand,
  linkCheck,
  LONG_MARK,
  RESPONSE_PREAMBLE,
} from "./beken-packets.js";

/** What a command waits for its response. */
export const COMMAND_MS = 1000;
/** What one LinkCheck waits before the next is sent, as bk7231tools does. */
const LINK_POLL_MS = 5;
/** The answers to the LinkChecks still on their way are let through, then dropped. */
const SETTLE_QUIET_MS = 20;
const SETTLE_WINDOW_MS = 300;
const RESET_HOLD_MS = 100;

/** The chip gave no response, or one that does not fit the command. */
export class BekenResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BekenResponseError";
  }
}

export class BekenLink extends SerialByteSession {
  // When the response to the command under way has to have started,
  // whatever keeps arriving: a firmware that logs on this port would hold
  // a wait that starts anew with every byte open without end. A payload
  // that is coming in has its length as its end.
  private deadline = 0;

  private async byte(): Promise<number> {
    // What is in already is handed out, however late it is asked for.
    const b = await this.readByte(Math.max(this.deadline - Date.now(), 0));
    if (b === null) throw new BekenResponseError("No response received");
    return b;
  }

  /** Read up to and with ``sequence``; whether it came with nothing before it. */
  private async readUntil(sequence: readonly number[]): Promise<boolean> {
    // None of the sequences repeats its first byte, so a byte that does
    // not fit can only start the sequence anew.
    let matched = 0;
    for (let read = 1; ; read++) {
      const b = await this.byte();
      matched = b === sequence[matched] ? matched + 1 : b === sequence[0] ? 1 : 0;
      if (matched === sequence.length) return read === sequence.length;
    }
  }

  /** The payload of the next response that fits ``command``. */
  private async response(command: BekenCommand, reply: number): Promise<Uint8Array> {
    let size: number;
    for (;;) {
      await this.readUntil(RESPONSE_PREAMBLE);
      size = await this.byte();
      if (command.long !== (size === 0xff)) continue;
      if (!(await this.readUntil(COMMAND_PREAMBLE))) continue;
      let code: number;
      if (command.long) {
        if (!(await this.readUntil([LONG_MARK]))) continue;
        const head = await this.bytes(3);
        size = (head[0] | (head[1] << 8)) - 1;
        code = head[2];
      } else {
        code = await this.byte();
        size -= 4;
      }
      if (code === reply) break;
    }
    if (size < (command.least ?? 0)) throw new BekenResponseError("Incomplete response");
    const payload = await this.bytes(size);
    const { echo, status } = command;
    if (echo) {
      const sent = command.payload;
      for (let i = 0; i < echo.length; i++) {
        if (payload[echo.at + i] !== sent[i]) {
          throw new BekenResponseError(`${command.name}: the response is for another`);
        }
      }
    }
    for (const at of status ?? []) {
      if (payload[at] !== 0) {
        throw new BekenResponseError(`${command.name}: status ${payload[at]}`);
      }
    }
    return payload;
  }

  private async bytes(count: number): Promise<Uint8Array> {
    try {
      return await this.readBytes(count, Math.max(this.deadline - Date.now(), 0));
    } catch (err) {
      // A port that is gone, or an abort, is not the chip's answer.
      if (this.readEnded || this.signal?.aborted) throw err;
      throw new BekenResponseError("Incomplete response");
    }
  }

  /** Send ``command`` and return the payload of its response, empty for one without. */
  async command(command: BekenCommand, timeoutMs = COMMAND_MS): Promise<Uint8Array> {
    await this.writeBytes(encodeCommand(command));
    this.deadline = Date.now() + timeoutMs;
    if (command.reply === undefined) return new Uint8Array(0);
    return this.response(command, command.reply);
  }

  /** Let through what is still coming, until the line is quiet. */
  private async settle(): Promise<void> {
    const deadline = Date.now() + SETTLE_WINDOW_MS;
    while (Date.now() < deadline && (await this.waitForData(SETTLE_QUIET_MS)));
  }

  /**
   * LinkCheck until the downloader answers or ``timeoutMs`` passes. A running
   * LibreTiny firmware reboots into the downloader on the same packet, and a
   * chip coming out of reset listens for it for a moment, so the packets go
   * out back to back.
   */
  async link(timeoutMs: number): Promise<boolean> {
    const command = linkCheck();
    const deadline = Date.now() + timeoutMs;
    let linked = false;
    let sent = 0;
    do {
      sent++;
      try {
        const payload = await this.command(command, LINK_POLL_MS);
        linked = payload[0] === 0;
      } catch (err) {
        if (!(err instanceof BekenResponseError)) throw err;
      }
    } while (!linked && Date.now() < deadline);
    // The answers to the LinkChecks before are still on their way.
    if (linked && sent > 1) await this.settle();
    this.drain();
    return linked;
  }
}

/** Both lines released, as the chip needs them to run; false without lines to drive. */
export async function releaseLines(port: SerialPort): Promise<boolean> {
  try {
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    return true;
  } catch {
    return false;
  }
}

/**
 * Reset the chip over the adapter's lines, the sequence bk7231tools uses,
 * for an adapter whose RTS reaches CEN. False without lines to drive.
 */
export async function resetOverLines(port: SerialPort): Promise<boolean> {
  try {
    await port.setSignals({ dataTerminalReady: true, requestToSend: true });
    await sleep(RESET_HOLD_MS);
    await port.setSignals({ dataTerminalReady: false });
    await sleep(RESET_HOLD_MS);
    await port.setSignals({ requestToSend: false });
    return true;
  } catch {
    // Not with a line left held, which would keep the chip in reset.
    await releaseLines(port);
    return false;
  }
}
