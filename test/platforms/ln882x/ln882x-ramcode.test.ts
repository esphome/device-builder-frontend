import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LN882H_RAMCODE_SHA256,
  LN882H_RAMCODE_URL,
  Ln882xRamcodeError,
  loadRamcode,
  resetRamcodeCache,
} from "../../../src/platforms/ln882x/ln882x-ramcode.js";

const hex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

afterEach(() => {
  resetRamcodeCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const respond = (body: Uint8Array, status = 200) => {
  const fetchFn = vi.fn(async () => new Response(new Uint8Array(body), { status }));
  vi.stubGlobal("fetch", fetchFn);
  return fetchFn;
};

/** Pretend ``body`` is the release's file by matching its digest. */
function asTheRelease(body: Uint8Array) {
  const real = crypto.subtle.digest.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, "digest").mockImplementation(async (algo, data) =>
    hex(new Uint8Array(data as ArrayBuffer)) === hex(body)
      ? Uint8Array.from(LN882H_RAMCODE_SHA256.match(/../g)!.map((b) => parseInt(b, 16)))
          .buffer
      : real(algo, data)
  );
}

describe("loadRamcode", () => {
  it("fetches the pinned release's file and keeps it for the page", async () => {
    const body = new Uint8Array([1, 2, 3]);
    asTheRelease(body);
    const fetchFn = respond(body);

    const [first, second] = await Promise.all([loadRamcode(), loadRamcode()]);
    expect(first).toEqual(body);
    expect(second).toBe(first);
    expect(await loadRamcode()).toBe(first);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith(LN882H_RAMCODE_URL);
  });

  it("refuses a file whose hash is not the release's", async () => {
    respond(new Uint8Array([9]));
    const err = await loadRamcode().catch((e) => e);

    expect(err).toBeInstanceOf(Ln882xRamcodeError);
    expect(err.key).toBe("firmware.ln_ramcode_mismatch");
  });

  it("names a failed download, by status or by network error", async () => {
    respond(new Uint8Array(0), 404);
    const byStatus = await loadRamcode().catch((e) => e);
    expect(byStatus.key).toBe("firmware.ln_ramcode_unavailable");
    expect(byStatus.message).toContain("HTTP 404");

    // The failure was not kept: this is a fresh try.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );
    const byNetwork = await loadRamcode().catch((e) => e);
    expect(byNetwork.key).toBe("firmware.ln_ramcode_unavailable");
    expect(byNetwork.message).toContain("Failed to fetch");
  });

  it("pins the file ltchiptool 4.14.4 ships", () => {
    expect(LN882H_RAMCODE_URL).toContain("ltchiptool@v4.14.4/");
    expect(LN882H_RAMCODE_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });
});
