import { vi } from "vitest";

/**
 * Web Serial ``SerialPort`` mock for the web-side suites (distinct from
 * ``test/_make-serial-port.ts``, which builds the backend's port-listing
 * rows). Defaults cover the fields the streaming and hand-off paths touch;
 * pass overrides for the case under test.
 */
export function makeWebSerialPort(overrides: Record<string, unknown> = {}): SerialPort {
  return {
    readable: {},
    open: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    setSignals: vi.fn(async () => {}),
    getInfo: () => ({}),
    ...overrides,
  } as unknown as SerialPort;
}
