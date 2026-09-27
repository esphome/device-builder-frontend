/**
 * Bounds what esptool-js leaves unbounded. It puts a timeout on every read,
 * but a write or a control line change on a device that was unplugged can
 * stay pending, and whatever waits on it then never ends: the flash stayed
 * on "Flashing" until the dialog was closed (#1896).
 */
import type { Transport } from "esptool-js";

import {
  SerialDeviceLostError,
  SerialWriteStalledError,
} from "../../util/serial-open-error.js";
import { withDeadline } from "../../util/with-deadline.js";

/**
 * How long one write or line change gets. A write is one block of 16 KiB at
 * most, a few seconds at 115200 baud, so this is a device that stopped
 * taking data and not a slow link.
 *
 * The flash as a whole has no limit, and neither has the time between two
 * blocks: a large image takes minutes, and a block of an image with empty
 * regions can take the chip over a minute to write, which esptool-js waits
 * for on the read that follows.
 */
export const WRITE_DEADLINE_MS = 60_000;

const guards = new WeakMap<Transport, () => void>();

/**
 * From here until ``releaseTransportGuard``, fail the transport's writes and
 * line changes once the port reports the device gone, also when that
 * happened between two of them (a board unplugged during the compile), and
 * when one does not return by the deadline.
 */
export function guardTransport(transport: Transport): void {
  const port = transport.device;
  let lost = false;
  let markLost: (err: Error) => void = () => {};
  const gone = new Promise<never>((_, reject) => (markLost = reject));
  gone.catch(() => {});
  const onLost = () => {
    lost = true;
    markLost(new SerialDeviceLostError());
  };
  port.addEventListener("disconnect", onLost);

  const bound =
    <A extends unknown[]>(send: (...args: A) => Promise<void>) =>
    (...args: A): Promise<void> => {
      if (lost) return Promise.reject(new SerialDeviceLostError());
      return withDeadline(
        Promise.race([send(...args), gone]),
        WRITE_DEADLINE_MS,
        () => new SerialWriteStalledError(WRITE_DEADLINE_MS)
      );
    };
  const { write, setDTR, setRTS } = transport;
  transport.write = bound(write.bind(transport));
  transport.setDTR = bound(setDTR.bind(transport));
  transport.setRTS = bound(setRTS.bind(transport));

  guards.set(transport, () => {
    port.removeEventListener("disconnect", onLost);
    Object.assign(transport, { write, setDTR, setRTS });
  });
}

/** Undo ``guardTransport``; nothing to do for a transport that has none. */
export function releaseTransportGuard(transport: Transport): void {
  guards.get(transport)?.();
  guards.delete(transport);
}
