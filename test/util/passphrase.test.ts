import { afterEach, describe, expect, it, vi } from "vitest";
import { PASSPHRASE_WORDS } from "../../src/util/passphrase-words.js";
import { generatePassphrase } from "../../src/util/passphrase.js";

afterEach(() => vi.restoreAllMocks());

describe("generatePassphrase", () => {
  it("joins the requested number of lowercase words with hyphens", async () => {
    expect(await generatePassphrase()).toMatch(/^[a-z]+(-[a-z]+){3}$/); // default 4 words
    expect(await generatePassphrase(3)).toMatch(/^[a-z]+(-[a-z]+){2}$/);
    expect((await generatePassphrase(5)).split("-")).toHaveLength(5);
  });

  it("draws every word from the list", async () => {
    const set = new Set(PASSPHRASE_WORDS);
    for (const w of (await generatePassphrase(6)).split("-")) {
      expect(set.has(w)).toBe(true);
    }
  });

  it("maps each CSPRNG draw to a word and rejects out-of-range draws", async () => {
    // Deterministic: stub crypto.getRandomValues with a known sequence and pin
    // the index mapping (value % n) and the rejection of values >= the limit.
    const n = PASSPHRASE_WORDS.length;
    const limit = Math.floor(0x1_0000_0000 / n) * n;
    const seq = [0, limit, 5, n + 2]; // limit is rejected → skipped
    let i = 0;
    vi.spyOn(crypto, "getRandomValues").mockImplementation((arr) => {
      (arr as Uint32Array)[0] = seq[i++];
      return arr;
    });
    expect(await generatePassphrase(3)).toBe(
      [PASSPHRASE_WORDS[0], PASSPHRASE_WORDS[5], PASSPHRASE_WORDS[2]].join("-")
    );
  });

  it("clamps a non-positive count to a single word (never empty)", async () => {
    expect(await generatePassphrase(0)).toMatch(/^[a-z]+$/);
    expect(await generatePassphrase(-3)).toMatch(/^[a-z]+$/);
  });

  it("is a large, de-duplicated list of short lowercase words", () => {
    expect(PASSPHRASE_WORDS.length).toBeGreaterThanOrEqual(2000); // ~44 bits at 4 words
    expect(new Set(PASSPHRASE_WORDS).size).toBe(PASSPHRASE_WORDS.length);
    expect(PASSPHRASE_WORDS.every((w) => /^[a-z]{3,8}$/.test(w))).toBe(true);
  });
});
