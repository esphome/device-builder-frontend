import { vi } from "vitest";
import { disconnectEvents } from "../../_web-serial.js";
import { crc32 } from "../../../src/util/crc32.js";
import { makeWebSerialPort } from "../../web/_make-web-serial-port.js";

import {
  OBJECT_COMMAND,
  OBJECT_DATA,
  OP_CALC_CRC,
  OP_CREATE,
  OP_EXECUTE,
  OP_GET_MTU,
  OP_PING,
  OP_RESPONSE,
  OP_SELECT,
  OP_SET_PRN,
  OP_WRITE,
  RESULT_SUCCESS,
} from "../../../src/platforms/nrf52/nrf-secure-dfu.js";
import { slipDecode, slipEncode } from "../../../src/platforms/nrf52/slip.js";

const u32 = (v: number) => [
  v & 0xff,
  (v >> 8) & 0xff,
  (v >> 16) & 0xff,
  (v >>> 24) & 0xff,
];

interface Progress {
  committed: number[];
  object: number[] | null;
  objectSize: number;
}

/**
 * The nRF5 SDK bootloader's request handler, as pc-nrfutil sees it: objects
 * are created, written, checked and executed; a new command object resets
 * every progress, and the executed data objects make up the image.
 */
export class FakeOpenDfuBootloader {
  mtu = 64;
  maxCommandSize = 512;
  maxDataSize = 4096;
  prn: number | null = null;
  /** Every request's opcode, in order. */
  readonly requests: number[] = [];
  /** Replaces the reply to a request (the payload after ``0x60 <op>``); undefined to answer normally. */
  onRequest?: (op: number, args: Uint8Array) => number[] | undefined;
  /** Answer the first ping with a stale id, as a bootloader with a leftover frame. */
  stalePingReply = false;

  private progress: Record<number, Progress> = {
    [OBJECT_COMMAND]: { committed: [], object: null, objectSize: 0 },
    [OBJECT_DATA]: { committed: [], object: null, objectSize: 0 },
  };
  private current: number | null = null;

  /** The init packet, once its object executed. */
  get initPacket(): Uint8Array {
    return new Uint8Array(this.progress[OBJECT_COMMAND].committed);
  }

  /** The image, from the data objects executed so far. */
  get image(): Uint8Array {
    return new Uint8Array(this.progress[OBJECT_DATA].committed);
  }

  /** The reply to one decoded request frame; null for a write (no receipt asked for). */
  handle(frame: Uint8Array): number[] | null {
    const op = frame[0];
    const args = frame.subarray(1);
    this.requests.push(op);
    const override = this.onRequest?.(op, args);
    if (override) return [OP_RESPONSE, op, ...override];
    const ok = (...payload: number[]) => [OP_RESPONSE, op, RESULT_SUCCESS, ...payload];
    switch (op) {
      case OP_PING: {
        if (this.stalePingReply) {
          this.stalePingReply = false;
          return ok((args[0] - 1) & 0xff);
        }
        return ok(args[0]);
      }
      case OP_SET_PRN:
        this.prn = args[0] | (args[1] << 8);
        return ok();
      case OP_GET_MTU:
        return ok(this.mtu & 0xff, this.mtu >> 8);
      case OP_SELECT: {
        const p = this.progress[args[0]];
        const max = args[0] === OBJECT_COMMAND ? this.maxCommandSize : this.maxDataSize;
        return ok(
          ...u32(max),
          ...u32(p.committed.length),
          ...u32(crc32(new Uint8Array(p.committed)))
        );
      }
      case OP_CREATE: {
        const type = args[0];
        const size = args[1] | (args[2] << 8) | (args[3] << 16) | (args[4] << 24);
        if (type === OBJECT_COMMAND) {
          // A new init packet: every progress goes.
          for (const p of Object.values(this.progress)) {
            p.committed = [];
            p.object = null;
          }
        }
        this.progress[type].object = [];
        this.progress[type].objectSize = size;
        this.current = type;
        return ok();
      }
      case OP_WRITE: {
        this.progress[this.current!].object!.push(...args);
        return null;
      }
      case OP_CALC_CRC: {
        const p = this.progress[this.current!];
        const all = new Uint8Array([...p.committed, ...(p.object ?? [])]);
        return ok(...u32(all.length), ...u32(crc32(all)));
      }
      case OP_EXECUTE: {
        const p = this.progress[this.current!];
        if (!p.object || p.object.length !== p.objectSize) {
          return [OP_RESPONSE, op, 0x08]; // operation not permitted
        }
        p.committed.push(...p.object);
        p.object = null;
        return ok();
      }
      default:
        return [OP_RESPONSE, op, 0x02]; // not supported
    }
  }
}

/**
 * A Web Serial port with the fake bootloader behind it: the host's frames
 * are decoded off the written bytes and each reply goes back SLIP-framed.
 * The port is built open, as a freshly opened one.
 */
export function fakeOpenDfuPort(bootloader = new FakeOpenDfuBootloader()) {
  let rx!: ReadableStreamDefaultController<Uint8Array>;
  let pending: number[] = [];
  const written: Uint8Array[] = [];
  const port = makeWebSerialPort({
    close: vi.fn(async () => {
      try {
        rx.close();
      } catch {
        // already closed by the reader's cancel
      }
    }),
    ...disconnectEvents(),
    getInfo: () => ({ usbVendorId: 0x1915, usbProductId: 0x521f }),
    readable: new ReadableStream<Uint8Array>({ start: (c) => (rx = c) }),
    writable: new WritableStream<Uint8Array>({
      write: (chunk) => {
        written.push(chunk);
        for (const b of chunk) {
          if (b !== 0xc0) {
            pending.push(b);
            continue;
          }
          const frame = slipDecode(new Uint8Array(pending));
          pending = [];
          if (frame.length === 0) continue;
          const reply = bootloader.handle(frame);
          if (reply)
            rx.enqueue(new Uint8Array([...slipEncode(new Uint8Array(reply)), 0xc0]));
        }
      },
    }),
  });
  return { port, bootloader, written };
}
