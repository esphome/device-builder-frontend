import {
  SerialDeviceLostError,
  SerialWriteStalledError,
} from "../../util/serial-open-error.js";

/**
 * How long a write may go without progress. The stub reports each block it
 * takes, a few a second, so a minute of silence is a device that stopped
 * answering and not a slow link. The whole write gets no deadline: a large
 * image over a slow bridge takes minutes.
 */
export const WRITE_STALL_MS = 60_000;

/**
 * ``work`` on ``port``, failed as soon as the device goes away, and
 * after ``stallMs`` without ``progressed`` being called where that is given.
 *
 * esptool-js bounds each read but not its writes: a write to a device that
 * was unplugged can stay pending, and nothing else ends the operation
 * (#1896). The work itself keeps running, abandoned, as with
 * ``withDeadline``; ``live`` tells its callbacks apart from a running one's.
 */
export function whileDevicePresent<T>(
  port: SerialPort,
  work: (guard: { progressed: () => void; live: () => boolean }) => Promise<T>,
  stallMs?: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (act: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      port.removeEventListener("disconnect", onLost);
      act();
    };
    const onLost = () => settle(() => reject(new SerialDeviceLostError()));
    const progressed = () => {
      if (settled || stallMs === undefined) return;
      clearTimeout(timer);
      timer = setTimeout(
        () => settle(() => reject(new SerialWriteStalledError(stallMs))),
        stallMs
      );
    };
    port.addEventListener("disconnect", onLost);
    progressed();
    work({ progressed, live: () => !settled }).then(
      (value) => settle(() => resolve(value)),
      (err: unknown) => settle(() => reject(err))
    );
  });
}
