import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isOwnSerialReenumeration,
  markSerialActivity,
  portOfSerialConnectEvent,
  SERIAL_ACTIVITY_WINDOW_MS,
  SerialConnectAnnouncements,
} from "../../src/util/serial-reacquire.js";

const port = () => ({ getInfo: () => ({}) }) as unknown as SerialPort;

afterEach(() => {
  vi.useRealTimers();
});

describe("portOfSerialConnectEvent", () => {
  it("takes the port from the event target, or the legacy port property", () => {
    const p = port();
    expect(portOfSerialConnectEvent({ target: p } as unknown as Event)).toBe(p);
    expect(portOfSerialConnectEvent({ port: p, target: null } as unknown as Event)).toBe(
      p
    );
    expect(portOfSerialConnectEvent({ target: {} } as unknown as Event)).toBeNull();
    // A legacy property holding something else must not hide the target.
    expect(portOfSerialConnectEvent({ port: "x", target: p } as unknown as Event)).toBe(
      p
    );
  });
});

describe("isOwnSerialReenumeration", () => {
  it("is true inside the activity window and extends it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    expect(isOwnSerialReenumeration()).toBe(false);
    markSerialActivity();
    vi.setSystemTime(1_000_000 + SERIAL_ACTIVITY_WINDOW_MS - 1);
    expect(isOwnSerialReenumeration()).toBe(true);
    // The check itself moved the window's start to now.
    vi.setSystemTime(1_000_000 + 2 * SERIAL_ACTIVITY_WINDOW_MS - 2);
    expect(isOwnSerialReenumeration()).toBe(true);
    vi.setSystemTime(1_000_000 + 4 * SERIAL_ACTIVITY_WINDOW_MS);
    expect(isOwnSerialReenumeration()).toBe(false);
  });
});

describe("SerialConnectAnnouncements", () => {
  it("announces a port once per window, per port", () => {
    const seen = new SerialConnectAnnouncements(1000);
    const a = port();
    const b = port();
    expect(seen.shouldAnnounce(a, 0)).toBe(true);
    expect(seen.shouldAnnounce(a, 500)).toBe(false);
    expect(seen.shouldAnnounce(b, 500)).toBe(true);
    expect(seen.shouldAnnounce(a, 1000)).toBe(true);
  });

  it("stays quiet for a connect that follows the port's own disconnect within the blip", () => {
    const seen = new SerialConnectAnnouncements(60_000, 1000);
    const hubbed = port();
    const other = port();
    seen.noteDisconnect(hubbed, 0);
    // The hub bounced it; the neighbour it did not touch still announces.
    expect(seen.shouldAnnounce(hubbed, 500)).toBe(false);
    expect(seen.shouldAnnounce(other, 500)).toBe(true);
    // The blip never took the once-per-window slot: a real plug-in announces.
    expect(seen.shouldAnnounce(hubbed, 5000)).toBe(true);
  });

  it("treats a connect past the blip as a plug-in", () => {
    const seen = new SerialConnectAnnouncements(60_000, 1000);
    const replugged = port();
    seen.noteDisconnect(replugged, 0);
    expect(seen.shouldAnnounce(replugged, 1000)).toBe(true);
  });

  it("only the first connect after a disconnect counts as the blip", () => {
    const seen = new SerialConnectAnnouncements(1000, 1000);
    const p = port();
    seen.noteDisconnect(p, 0);
    expect(seen.shouldAnnounce(p, 100)).toBe(false);
    // A second connect inside the same second with no disconnect between is
    // the once-per-window rule's business, not the blip's.
    expect(seen.shouldAnnounce(p, 200)).toBe(true);
    expect(seen.shouldAnnounce(p, 300)).toBe(false);
  });
});
