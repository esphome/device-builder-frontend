/**
 * The one signal for a serial device going away, for every flash engine: a
 * stream write to a device that was unplugged can stay pending, and an engine
 * that only bounds its reads would wait on it without end (#1896).
 */
import { SerialDeviceLostError } from "./serial-open-error.js";

export interface PortLost {
  /** The error once the device is gone, also when that was a while ago. */
  readonly lost: SerialDeviceLostError | null;
  /** Rejects with it; never settles while the device is there. */
  readonly gone: Promise<never>;
  /** Stop watching. */
  dispose(): void;
}

/** Watch ``port`` for the device going away, from now until ``dispose``. */
export function watchPortLost(port: SerialPort): PortLost {
  let lost: SerialDeviceLostError | null = null;
  let reject: (err: SerialDeviceLostError) => void = () => {};
  const gone = new Promise<never>((_, fail) => (reject = fail));
  gone.catch(() => {}); // Nobody waiting on it is not an error.
  const onLost = () => {
    if (lost) return;
    lost = new SerialDeviceLostError();
    reject(lost);
  };
  port.addEventListener("disconnect", onLost);
  // Gone before anyone watched: the event has been and will not come again.
  if (port.connected === false) onLost();
  return {
    get lost() {
      return lost;
    },
    gone,
    dispose: () => port.removeEventListener("disconnect", onLost),
  };
}
