import { describe, expect, it } from "vitest";
import { pinSha256ToEmojis } from "../../src/util/pin-emoji.js";
import { formatPinSha256 } from "../../src/util/pin-format.js";

// These two utils render the receiver's SHA-256 identity fingerprint for
// out-of-band (OOB) pairing verification: a human compares what their side
// shows against the peer's screen. The byte-pair and emoji forms are the
// signal the comparison rests on, so their bit-extraction and grouping are
// pinned here.

describe("formatPinSha256", () => {
  it("groups hex into space-separated byte pairs", () => {
    expect(formatPinSha256("abcdef0123")).toBe("ab cd ef 01 23");
  });

  it("returns an empty string for empty input", () => {
    expect(formatPinSha256("")).toBe("");
  });

  it("leaves a trailing odd nibble as a single-char group", () => {
    // Malformed (odd-length) input renders verbatim rather than hiding.
    expect(formatPinSha256("abc")).toBe("ab c");
  });

  it("applies pair-splitting verbatim to non-hex input", () => {
    // The util doesn't validate; a separate identity-load error path owns that.
    expect(formatPinSha256("hello!")).toBe("he ll o!");
  });
});

describe("pinSha256ToEmojis", () => {
  it("returns an empty array for empty input", () => {
    expect(pinSha256ToEmojis("")).toEqual([]);
  });

  it("maps the leading 6 bits of 0x00 to the first vocabulary slot", () => {
    const slots = pinSha256ToEmojis("00", 2);
    // 8 bits available -> one 6-bit chunk (0) -> slot 0; remainder too small.
    expect(slots).toHaveLength(1);
    expect(slots[0]!.name).toBe("Dog");
  });

  it("maps the leading 6 bits of 0xff to the last vocabulary slot", () => {
    const slots = pinSha256ToEmojis("ff", 2);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.name).toBe("Pin");
  });

  it("carries leftover bits forward across hex digits", () => {
    // 0xffff -> two 6-bit chunks of all-ones -> slot 63 twice.
    const slots = pinSha256ToEmojis("ffff", 2);
    expect(slots.map((s) => s.name)).toEqual(["Pin", "Pin"]);
  });

  it("produces the requested count when enough bits are present", () => {
    // 16 hex chars = 64 bits, comfortably more than 7 * 6 = 42 bits.
    expect(pinSha256ToEmojis("abcdef0123456789")).toHaveLength(7);
  });

  it("defaults to 7 emojis (42 bits, the Matrix SAS choice)", () => {
    expect(pinSha256ToEmojis("ffffffffffffffff").length).toBe(7);
  });

  it("truncates rather than pads when the input is too short", () => {
    // A single nibble yields only 4 bits — not enough for one 6-bit chunk.
    expect(pinSha256ToEmojis("a", 7)).toEqual([]);
  });

  it("is case-insensitive over hex input", () => {
    expect(pinSha256ToEmojis("FF", 2)).toEqual(pinSha256ToEmojis("ff", 2));
  });

  it("stops at the first non-hex character", () => {
    expect(pinSha256ToEmojis("zz")).toEqual([]);
  });

  it("returns fresh slot objects so callers can't mutate the table", () => {
    const a = pinSha256ToEmojis("ff", 1);
    const b = pinSha256ToEmojis("ff", 1);
    expect(a[0]).not.toBe(b[0]);
    expect(a[0]).toEqual(b[0]);
  });
});
