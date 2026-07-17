/**
 * @vitest-environment happy-dom
 * @vitest-environment-options { "settings": { "fetch": { "virtualServers": [ { "url": "https://esphome.github.io/device-builder/esp-stacktrace-decoder/", "directory": "./test/fixtures/decoder-stub" } ] } } }
 *
 * Pins the hosted decoder's contract: it frames the page once, authenticates
 * with a one-way nonce, and treats every failure as "no decode" rather than
 * letting it reach the log.
 *
 * The decoder URL is served from a local stub, because happy-dom really loads
 * an iframe's src and the src here is the production URL: without this, every
 * run would fetch esphome.github.io, which is slow, fails offline, and is the
 * exact coupling this design exists to avoid. Disabling iframe loading outright
 * would be simpler but leaves contentWindow null, and that window is what the
 * source check authenticates against. The real page is covered in the
 * device-builder repo, in a real browser, against a real ELF.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DECODER_ORIGIN } from "../../src/common/docs.js";
import { hostedDecoder, resetHostedDecoder } from "../../src/util/stacktrace-decoder.js";

const READY = "esphome-stacktrace-decode:ready";
const REQUEST = "esphome-stacktrace-decode:request";
const RESULT = "esphome-stacktrace-decode:result";
const ERROR = "esphome-stacktrace-decode:error";
const UNAVAILABLE = "esphome-stacktrace-decode:unavailable";

/** The one iframe the decoder framed. */
const frame = () => document.querySelector("iframe");

/**
 * Answer as the hosted page would.
 *
 * The stub the frame loads is inert, so nothing inside it ever speaks; stand in
 * for it. `source` has to be the frame's real contentWindow, because that
 * identity check is half of what authenticates the channel.
 */
function reply(data: unknown): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      data,
      origin: DECODER_ORIGIN,
      source: frame()!.contentWindow as Window,
    })
  );
}

/** Answer `ready` as soon as the page is framed, as the real one does. */
function autoReady(version = 1): void {
  queueMicrotask(() => reply({ type: READY, version }));
}

beforeEach(() => {
  resetHostedDecoder();
  document.body.innerHTML = "";
  vi.useFakeTimers();
});

afterEach(async () => {
  vi.useRealTimers();
  // Give the frame's navigation a moment to settle before the global afterEach
  // wipes the body. happy-dom navigates on its own schedule and then reaches
  // into a window the teardown has already dropped, which throws deep in its
  // internals. Cosmetic only: the assertions pass either way, and the fake
  // timers mean a test can retire a frame while its real navigation is still in
  // flight, so this is best-effort noise suppression rather than a fix. If the
  // stack traces come back on a loaded machine, that is all that has happened.
  await new Promise((resolve) => setTimeout(resolve, 25));
  vi.restoreAllMocks();
});

describe("hostedDecoder", () => {
  it("frames the decoder hidden, with a nonce and the dashboard's origin", async () => {
    autoReady();
    await hostedDecoder().available();

    const el = frame()!;
    expect(el.hidden).toBe(true);
    const hash = new URLSearchParams(new URL(el.src).hash.slice(1));
    expect(hash.get("nonce")).toMatch(/^[0-9a-f]{32}$/);
    // Pins the outbound targetOrigin from frame zero rather than leaving the
    // page broadcasting until it learns ours.
    expect(hash.get("origin")).toBe(location.origin);
  });

  it("reports unavailable when the decoder never answers", async () => {
    // GitHub down, or an install with no internet. An iframe that never loads
    // fires no error worth trusting, so this is the timeout path.
    const available = hostedDecoder().available();
    await vi.advanceTimersByTimeAsync(11_000);

    expect(await available).toBe(false);
    // ...and the dead frame is cleaned up rather than left in the document.
    expect(frame()).toBeNull();
  });

  it("gives up at once when the page says it cannot answer", async () => {
    // A wiring mistake (no nonce in the hash) is not an outage, and the page's
    // own console is inside a hidden frame where nobody reads it. Told
    // directly, we stop rather than sit out the full timeout.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    queueMicrotask(() => reply({ type: UNAVAILABLE, reason: "framed without a nonce" }));

    // No timer advance: the point is that it does not wait.
    expect(await hostedDecoder().available()).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.any(String), "framed without a nonce");
    expect(frame()).toBeNull();
  });

  it("remembers the verdict, so a crash loop reframes nothing", async () => {
    autoReady();
    expect(await hostedDecoder().available()).toBe(true);
    expect(await hostedDecoder().available()).toBe(true);

    expect(document.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("sends the ELF with the nonce and resolves the frames", async () => {
    autoReady();
    await hostedDecoder().available();
    const post = vi.spyOn(frame()!.contentWindow as Window, "postMessage");
    const elf = new ArrayBuffer(8);

    const pending = hostedDecoder().decode(elf, "Backtrace: 0x400d1a2c");
    await vi.advanceTimersByTimeAsync(0); // decode() awaits available() before it posts
    // The 3-arg (message, targetOrigin, transfer) overload; the spy's inferred
    // signature is the 2-arg (message, options) one, so name the shape we sent.
    const call = post.mock.calls[0] as unknown as [
      { type: string; nonce: string; id: string },
      string,
      Transferable[],
    ];
    const sent = call[0];
    expect(sent.type).toBe(REQUEST);
    expect(sent.nonce).toMatch(/^[0-9a-f]{32}$/);
    // Targeted, never '*': the ELF is the user's firmware.
    expect(call[1]).toBe(DECODER_ORIGIN);
    // Not transferred. The decoder is a foreign origin, so the bytes are copied
    // across the process boundary either way; transferring would only detach
    // the caller's cached ELF and force it to copy first.
    expect(call[2]).toBeUndefined();
    expect(elf.byteLength).toBe(8); // still ours, not detached

    reply({
      type: RESULT,
      id: sent.id,
      frames: [{ address: 0x400d1a2c, function_name: "setup()", location: "a.cpp:1" }],
    });

    expect(await pending).toEqual([
      { address: 0x400d1a2c, function_name: "setup()", location: "a.cpp:1" },
    ]);
  });

  it("resolves null when the decoder reports an error", async () => {
    autoReady();
    await hostedDecoder().available();
    const post = vi.spyOn(frame()!.contentWindow as Window, "postMessage");

    const pending = hostedDecoder().decode(new ArrayBuffer(8), "Backtrace: 0x1");
    await vi.advanceTimersByTimeAsync(0); // decode() awaits available() before it posts
    const { id } = post.mock.calls[0][0] as { id: string };
    reply({ type: ERROR, id, message: "unreadable elf" });

    expect(await pending).toBeNull();
  });

  it("resolves null when the decode never comes back", async () => {
    autoReady();
    await hostedDecoder().available();

    const pending = hostedDecoder().decode(new ArrayBuffer(8), "Backtrace: 0x1");
    await vi.advanceTimersByTimeAsync(61_000);

    expect(await pending).toBeNull();
  });

  it("ignores a reply from the wrong origin", async () => {
    autoReady();
    await hostedDecoder().available();
    const post = vi.spyOn(frame()!.contentWindow as Window, "postMessage");

    const pending = hostedDecoder().decode(new ArrayBuffer(8), "Backtrace: 0x1");
    await vi.advanceTimersByTimeAsync(0); // decode() awaits available() before it posts
    const { id } = post.mock.calls[0][0] as { id: string };
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: RESULT,
          id,
          frames: [{ address: 1, function_name: "evil", location: "" }],
        },
        origin: "https://evil.example.com",
        source: frame()!.contentWindow as Window,
      })
    );
    await vi.advanceTimersByTimeAsync(61_000);

    expect(await pending).toBeNull();
  });

  it("ignores a reply correlated to a different request", async () => {
    autoReady();
    await hostedDecoder().available();
    const post = vi.spyOn(frame()!.contentWindow as Window, "postMessage");

    const pending = hostedDecoder().decode(new ArrayBuffer(8), "Backtrace: 0x1");
    reply({ type: RESULT, id: "someone-else", frames: [] });
    await vi.advanceTimersByTimeAsync(61_000);

    expect(await pending).toBeNull();
    expect(post).toHaveBeenCalled();
  });

  it("proceeds against a decoder speaking a newer protocol", async () => {
    // Additive changes don't bump the version, so a newer page still
    // understands our v1 frame; warn rather than refuse to decode.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    autoReady(99);

    expect(await hostedDecoder().available()).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("v99"));
  });
});
