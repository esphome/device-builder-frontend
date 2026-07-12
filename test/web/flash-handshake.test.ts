// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FlashHandshake,
  parseFlasherParams,
} from "../../src/web/flash-receiver/flash-handshake.js";

function makeEnv(origin: string | null = null, nonce = "n1") {
  const opener = { postMessage: vi.fn() };
  const target = new EventTarget();
  return {
    opener,
    target,
    env: {
      opener: opener as unknown as Window,
      params: { nonce, origin },
      messageTarget: target,
    },
  };
}

function fireMessage(
  target: EventTarget,
  detail: { source: unknown; origin?: string; data: unknown }
): void {
  const ev = new Event("message");
  Object.assign(ev, {
    source: detail.source,
    origin: detail.origin ?? "",
    data: detail.data,
  });
  target.dispatchEvent(ev);
}

const firmware = (over: Record<string, unknown> = {}) => ({
  type: "esphome-web-flash:firmware",
  nonce: "n1",
  parts: [{ address: 0, data: new ArrayBuffer(8) }],
  ...over,
});

const readyFrames = (opener: { postMessage: ReturnType<typeof vi.fn> }) =>
  opener.postMessage.mock.calls.filter(
    (c) => (c[0] as { type?: string }).type === "esphome-web-flash:ready"
  );

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("parseFlasherParams", () => {
  it("returns nonce + origin when the nonce is present", () => {
    expect(parseFlasherParams("#nonce=abc&origin=https://d.example")).toEqual({
      nonce: "abc",
      origin: "https://d.example",
    });
    expect(parseFlasherParams("nonce=abc")).toEqual({ nonce: "abc", origin: null });
  });

  it("returns null without a nonce (not a hand-off)", () => {
    expect(parseFlasherParams("")).toBeNull();
    expect(parseFlasherParams("#origin=https://d.example")).toBeNull();
  });
});

describe("FlashHandshake", () => {
  it("announces ready without echoing the nonce, version 1", () => {
    const { opener, env } = makeEnv();
    new FlashHandshake(env, { onFirmware: vi.fn(), onMalformed: vi.fn() }).start();
    const ready = readyFrames(opener);
    expect(ready.length).toBeGreaterThan(0);
    expect(ready[0][0]).toEqual({ type: "esphome-web-flash:ready", version: 1 });
    expect("nonce" in (ready[0][0] as object)).toBe(false);
  });

  it("re-announces ready until firmware arrives", () => {
    const { opener, env } = makeEnv();
    new FlashHandshake(env, { onFirmware: vi.fn(), onMalformed: vi.fn() }).start();
    const first = readyFrames(opener).length;
    vi.advanceTimersByTime(1500);
    expect(readyFrames(opener).length).toBeGreaterThan(first);
  });

  it("accepts a valid firmware frame and stops re-announcing", () => {
    const { opener, target, env } = makeEnv();
    const onFirmware = vi.fn();
    new FlashHandshake(env, { onFirmware, onMalformed: vi.fn() }).start();

    fireMessage(target, {
      source: opener,
      origin: "https://d.example",
      data: firmware(),
    });
    expect(onFirmware).toHaveBeenCalledOnce();

    const before = readyFrames(opener).length;
    vi.advanceTimersByTime(2000);
    expect(readyFrames(opener).length).toBe(before); // retry stopped
  });

  it("ignores a duplicate firmware frame after hand-off", () => {
    const { opener, target, env } = makeEnv();
    const onFirmware = vi.fn();
    new FlashHandshake(env, { onFirmware, onMalformed: vi.fn() }).start();
    fireMessage(target, { source: opener, data: firmware() });
    fireMessage(target, { source: opener, data: firmware() });
    // A re-sent frame must not re-fire (it would reset the UI mid-flash).
    expect(onFirmware).toHaveBeenCalledOnce();
  });

  it("fires onTimeout when no firmware arrives within the ready window", () => {
    const { env } = makeEnv();
    const onTimeout = vi.fn();
    new FlashHandshake(env, {
      onFirmware: vi.fn(),
      onMalformed: vi.fn(),
      onTimeout,
    }).start();
    vi.advanceTimersByTime(10000);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it("does not fire onTimeout once firmware has arrived", () => {
    const { opener, target, env } = makeEnv();
    const onTimeout = vi.fn();
    new FlashHandshake(env, {
      onFirmware: vi.fn(),
      onMalformed: vi.fn(),
      onTimeout,
    }).start();
    fireMessage(target, { source: opener, data: firmware() });
    vi.advanceTimersByTime(20000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("ignores a wrong nonce", () => {
    const { opener, target, env } = makeEnv();
    const onFirmware = vi.fn();
    new FlashHandshake(env, { onFirmware, onMalformed: vi.fn() }).start();
    fireMessage(target, { source: opener, data: firmware({ nonce: "WRONG" }) });
    expect(onFirmware).not.toHaveBeenCalled();
  });

  it("ignores a frame from a source that isn't the opener", () => {
    const { target, env } = makeEnv();
    const onFirmware = vi.fn();
    new FlashHandshake(env, { onFirmware, onMalformed: vi.fn() }).start();
    fireMessage(target, { source: { other: true }, data: firmware() });
    expect(onFirmware).not.toHaveBeenCalled();
  });

  it("reports malformed parts and stops re-announcing", () => {
    const { opener, target, env } = makeEnv();
    const onMalformed = vi.fn();
    new FlashHandshake(env, { onFirmware: vi.fn(), onMalformed }).start();
    fireMessage(target, {
      source: opener,
      data: firmware({ parts: [{ address: 0, data: "nope" }] }),
    });
    expect(onMalformed).toHaveBeenCalledOnce();
    const before = readyFrames(opener).length;
    vi.advanceTimersByTime(2000);
    expect(readyFrames(opener).length).toBe(before);
  });

  it("relays state and progress to the opener", () => {
    const { opener, env } = makeEnv("https://d.example");
    const hs = new FlashHandshake(env, { onFirmware: vi.fn(), onMalformed: vi.fn() });
    hs.start();
    hs.postState("installing", "Writing…");
    hs.postProgress(42);
    expect(opener.postMessage).toHaveBeenCalledWith(
      { type: "esphome-web-flash:state", state: "installing", detail: "Writing…" },
      "https://d.example"
    );
    expect(opener.postMessage).toHaveBeenCalledWith(
      { type: "esphome-web-flash:progress", pct: 42 },
      "https://d.example"
    );
  });

  it("learns the target origin from the first inbound frame when unpinned", () => {
    const { opener, target, env } = makeEnv(null);
    const hs = new FlashHandshake(env, { onFirmware: vi.fn(), onMalformed: vi.fn() });
    hs.start();
    // Pre-handoff frames broadcast to '*'.
    expect(readyFrames(opener)[0][1]).toBe("*");
    fireMessage(target, {
      source: opener,
      origin: "https://learned.example",
      data: firmware(),
    });
    hs.postState("done", "ok");
    const calls = opener.postMessage.mock.calls;
    const last = calls[calls.length - 1];
    expect(last?.[1]).toBe("https://learned.example");
  });

  it("falls back to '*' when the pinned origin makes postMessage throw", () => {
    const { opener, env } = makeEnv("https://pinned.example");
    opener.postMessage.mockImplementationOnce(() => {
      throw new Error("bad targetOrigin");
    });
    new FlashHandshake(env, { onFirmware: vi.fn(), onMalformed: vi.fn() }).start();
    // First attempt to the pinned origin threw; the catch retried to '*'.
    expect(opener.postMessage).toHaveBeenCalledWith(expect.anything(), "*");
  });
});
