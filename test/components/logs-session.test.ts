import { describe, expect, it } from "vitest";
import {
  hasSerialPort,
  isPassive,
  isStreaming,
  type LogsSession,
} from "../../src/components/logs-session.js";

const fakePort = {} as SerialPort;
const noop = () => {};

describe("logs-session selectors", () => {
  it("isStreaming: ota streams only with a live streamId", () => {
    expect(isStreaming({ kind: "ota", port: "OTA", streamId: "s1" })).toBe(true);
    expect(isStreaming({ kind: "ota", port: "OTA", streamId: null })).toBe(false);
  });

  it("isStreaming: serial/reconnecting stream unless paused", () => {
    expect(
      isStreaming({ kind: "serial", port: fakePort, cancel: noop, paused: false })
    ).toBe(true);
    expect(
      isStreaming({ kind: "serial", port: fakePort, cancel: noop, paused: true })
    ).toBe(false);
    expect(isStreaming({ kind: "reconnecting", paused: false })).toBe(true);
    expect(isStreaming({ kind: "reconnecting", paused: true })).toBe(false);
  });

  it("isStreaming: idle and dead never stream", () => {
    expect(isStreaming({ kind: "idle" })).toBe(false);
    expect(isStreaming({ kind: "dead" })).toBe(false);
  });

  it("isPassive: every Web Serial phase, never OTA/idle", () => {
    const passive: LogsSession[] = [
      { kind: "serial", port: fakePort, cancel: noop, paused: false },
      { kind: "reconnecting", paused: false },
      { kind: "dead" },
    ];
    for (const s of passive) expect(isPassive(s)).toBe(true);
    expect(isPassive({ kind: "ota", port: "OTA", streamId: "s1" })).toBe(false);
    expect(isPassive({ kind: "idle" })).toBe(false);
  });

  it("hasSerialPort: only the serial state holds a live port", () => {
    expect(
      hasSerialPort({ kind: "serial", port: fakePort, cancel: noop, paused: true })
    ).toBe(true);
    for (const s of [
      { kind: "reconnecting", paused: false },
      { kind: "dead" },
      { kind: "ota", port: "OTA", streamId: "s1" },
      { kind: "idle" },
    ] as LogsSession[]) {
      expect(hasSerialPort(s)).toBe(false);
    }
  });
});
