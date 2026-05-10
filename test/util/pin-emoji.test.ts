import { describe, expect, it } from "vitest";
import { pinSha256ToEmojis } from "../../src/util/pin-emoji.js";

describe("pinSha256ToEmojis", () => {
  it("returns an empty array for empty input", () => {
    expect(pinSha256ToEmojis("")).toEqual([]);
  });

  it("produces 7 emoji slots by default", () => {
    const pin = "deadbeefcafebabe1234567890abcdef".repeat(2);
    const emojis = pinSha256ToEmojis(pin);
    expect(emojis).toHaveLength(7);
    for (const slot of emojis) {
      expect(slot.emoji.length).toBeGreaterThan(0);
      expect(slot.name.length).toBeGreaterThan(0);
    }
  });

  it("respects an explicit count", () => {
    const pin = "deadbeefcafebabe1234567890abcdef".repeat(2);
    expect(pinSha256ToEmojis(pin, 3)).toHaveLength(3);
    expect(pinSha256ToEmojis(pin, 10)).toHaveLength(10);
  });

  it("indexes the leading 6-bit chunks correctly", () => {
    // Pin "f000..." = binary 1111_0000_0000_0000_0000 ...
    // Splitting MSB-first into 6-bit chunks:
    //   111100 = 60 (Anchor)
    //   000000 =  0 (Dog)
    //   000000 =  0 (Dog)
    // Pins the SAS table mapping against the bit-extraction
    // logic so future edits to either can't silently shift the
    // order without the test catching it.
    const pin = "f0" + "0".repeat(62);
    const emojis = pinSha256ToEmojis(pin, 3);
    expect(emojis.map((s) => s.name)).toEqual(["Anchor", "Dog", "Dog"]);
  });

  it("is deterministic for the same pin", () => {
    const pin = "abcdef0123456789".repeat(4);
    expect(pinSha256ToEmojis(pin)).toEqual(pinSha256ToEmojis(pin));
  });

  it("yields different sequences for different pins", () => {
    const a = pinSha256ToEmojis("deadbeef".repeat(8));
    const b = pinSha256ToEmojis("cafebabe".repeat(8));
    expect(a.map((s) => s.emoji).join("")).not.toBe(
      b.map((s) => s.emoji).join(""),
    );
  });

  it("truncates rather than padding when input is too short for count", () => {
    // 8 hex chars = 32 bits = 5 full 6-bit chunks (with 2 spare
    // bits left over that aren't enough for a 6th chunk).
    const emojis = pinSha256ToEmojis("ffffffff", 7);
    expect(emojis).toHaveLength(5);
  });

  it("handles uppercase hex", () => {
    const lower = pinSha256ToEmojis("abcdef0123456789".repeat(4));
    const upper = pinSha256ToEmojis("ABCDEF0123456789".repeat(4));
    expect(lower).toEqual(upper);
  });

  it("returns an empty array for count=0", () => {
    const pin = "deadbeefcafebabe".repeat(4);
    expect(pinSha256ToEmojis(pin, 0)).toEqual([]);
  });

  it("renders all-zero pin as the first emoji repeated", () => {
    // Independent check on bit order: an all-zero input must
    // index slot 0 every time. If the loop accidentally read
    // bits LSB-first, an all-zero input would still hit slot 0
    // and miss the bug; combined with the `f0` test (which
    // pins a non-zero leading chunk to a non-zero index), the
    // pair tightly constrains MSB-first 6-bit chunking.
    const emojis = pinSha256ToEmojis("0".repeat(64));
    expect(emojis).toHaveLength(7);
    expect(emojis.every((s) => s.name === "Dog")).toBe(true);
  });

  it("locks the full 7-emoji output for a realistic 64-char fingerprint", () => {
    // Snapshot a complete fingerprint mapping so a future
    // refactor of either the SAS table or the bit-extraction
    // loop fails loudly. The pin shape mirrors what the
    // backend actually broadcasts (lowercase 64-char hex of
    // the receiver's SPKI). If this expectation needs to
    // change, the security UX has changed and both
    // receiver-side and sender-side code paths need a
    // coordinated update — the test forces that conversation.
    const pin =
      "8b1a3f5e2c7d9061a4b8c5d2e3f47ab1" +
      "0c5d6e7f8a9b1c2d3e4f5a6b7c8d9e0f";
    const emojis = pinSha256ToEmojis(pin);
    expect(emojis.map((s) => s.name)).toEqual([
      "Wrench",
      "Telephone",
      "Gift",
      "Pin",
      "Banana",
      "Wrench",
      "Telephone",
    ]);
  });
});
