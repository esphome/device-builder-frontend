/**
 * Bounds what esptool-js leaves unbounded. It puts a timeout on every read,
 * but a write to a device that was unplugged can stay pending, and whatever
 * waits on it then never ends: the flash stayed on "Flashing" until the
 * dialog was closed (#1896).
 */
import type { Transport } from "esptool-js";

import { deviceLostFrom, SerialWriteStalledError } from "../../util/serial-open-error.js";
import { watchPortLost } from "../../util/serial-port-lost.js";
import { withDeadline } from "../../util/with-deadline.js";

/**
 * How long one write gets. A write is one block of 16 KiB at most, a few
 * seconds at 115200 baud, so this is a device that stopped taking data and
 * not a slow link.
 *
 * The flash as a whole has no limit, and neither has the time between two
 * blocks: a large image takes minutes, and a block of an image with empty
 * regions can take the chip over a minute to write, which esptool-js waits
 * for on the read that follows.
 */
export const WRITE_DEADLINE_MS = 60_000;

const guards = new WeakMap<Transport, () => void>();

/**
 * From here until ``releaseTransportGuard``, end the transport's writes and
 * reads with ``SerialDeviceLostError`` once the device is gone, also when it
 * went between two of them (a board unplugged during the compile), and a
 * write the device does not take by the deadline with
 * ``SerialWriteStalledError``.
 *
 * What ended the session ends every later call the same way: esptool-js
 * tries a block again and reports the last failure, which would otherwise be
 * the stream still locked by the write that hung, or a minute of waiting on
 * a port the browser already failed.
 */
export function guardTransport(transport: Transport): void {
  const watch = watchPortLost(transport.device);
  let ended: Error | null = null;
  const { write, read } = transport;

  const guarded = async <T>(io: () => Promise<T>, deadlineMs?: number): Promise<T> => {
    ended ??= watch.lost;
    if (ended) throw ended;
    const live = Promise.race([io(), watch.gone]);
    try {
      return deadlineMs === undefined
        ? await live
        : await withDeadline(
            live,
            deadlineMs,
            () => (ended = new SerialWriteStalledError(deadlineMs))
          );
    } catch (err) {
      // The browser can fail the stream before it reports the device gone.
      const lost = deviceLostFrom(err);
      if (!lost) throw err;
      throw (ended ??= lost);
    }
  };
  transport.write = (data) =>
    guarded(() => write.call(transport, data), WRITE_DEADLINE_MS);
  // A read keeps the timeout esptool-js gives it.
  transport.read = (timeout) => guarded(() => read.call(transport, timeout));

  guards.set(transport, () => {
    watch.dispose();
    Object.assign(transport, { write, read });
  });
}

/** Undo ``guardTransport``; nothing to do for a transport that has none. */
export function releaseTransportGuard(transport: Transport): void {
  guards.get(transport)?.();
  guards.delete(transport);
}
