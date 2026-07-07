import type { SerialPort } from "../src/api/types/system.js";

export function makeSerialPort(
  port: string,
  desc: string,
  overrides: Partial<SerialPort> = {}
): SerialPort {
  return { port, desc, vid: null, pid: null, hint: null, ...overrides };
}
