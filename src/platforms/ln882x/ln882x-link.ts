/**
 * The LN882H's UART downloader as a line protocol: ``version`` tells the
 * BootROM (a 20 character build date) from the RAM code (``RAMCODE``), and
 * the RAM code echoes every printable character it is sent. YMODEM runs
 * over the same bytes.
 */
import { SerialByteSession } from "../../util/serial-byte-session.js";
import type { XmodemIo } from "../../util/xmodem.js";

/** Who answered ``version``. */
type LnLinkState = "rom" | "ramcode";

/** Silence that ends a reply, as ltchiptool's read timeout. */
const REPLY_QUIET_MS = 200;
const REPLY_WINDOW_MS = 1000;
const PING_WINDOW_MS = 400;
const ECHO_MS = 1000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toLines = (bytes: Uint8Array): string[] =>
  decoder
    .decode(bytes)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

export class LnLink extends SerialByteSession implements XmodemIo {
  /** Whether the RAM code is the one answering, so commands echo. */
  ramcode = false;

  write(data: Uint8Array): Promise<void> {
    return this.writeBytes(data);
  }

  /** Send one command line; the RAM code's echo of it is read back. */
  async send(command: string): Promise<void> {
    this.drain();
    await this.writeBytes(encoder.encode(`${command}\r\n`));
    if (this.ramcode) await this.readBytes(command.length, ECHO_MS);
  }

  /** Send one command line and collect the lines that answer it. */
  async command(command: string, windowMs = REPLY_WINDOW_MS): Promise<string[]> {
    await this.send(command);
    return toLines(await this.readQuiet(REPLY_QUIET_MS, windowMs));
  }

  /** One ``version``; who answered, or null. */
  async ping(): Promise<LnLinkState | null> {
    // Not stripped as an echo: the answer says whether there is one.
    this.ramcode = false;
    const lines = await this.command("version", PING_WINDOW_MS);
    const last = lines[lines.length - 1];
    if (last === "RAMCODE") {
      this.ramcode = true;
      return "ramcode";
    }
    return last?.length === 20 && last[11] === "/" ? "rom" : null;
  }

  /** ``version`` until something answers or ``timeoutMs`` passes. */
  async link(timeoutMs: number): Promise<LnLinkState | null> {
    const deadline = Date.now() + timeoutMs;
    do {
      const state = await this.ping();
      if (state) return state;
    } while (Date.now() < deadline);
    return null;
  }
}
