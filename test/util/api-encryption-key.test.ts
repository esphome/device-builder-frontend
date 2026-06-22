import { describe, expect, it } from "vitest";
import {
  generateApiEncryptionKey,
  isApiEncryptionKeyField,
  isValidApiEncryptionKey,
} from "../../src/util/api-encryption-key.js";

describe("generateApiEncryptionKey", () => {
  it("returns a 44-char base64 string that decodes to 32 bytes", () => {
    const key = generateApiEncryptionKey();
    expect(key).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(atob(key).length).toBe(32);
  });

  it("returns a fresh key each call", () => {
    const a = generateApiEncryptionKey();
    const b = generateApiEncryptionKey();
    expect(a).not.toBe(b);
  });
});

describe("isValidApiEncryptionKey", () => {
  it("accepts a freshly generated key", () => {
    expect(isValidApiEncryptionKey(generateApiEncryptionKey())).toBe(true);
  });

  it("rejects wrong length, non-base64, and empty values", () => {
    expect(isValidApiEncryptionKey("")).toBe(false);
    expect(isValidApiEncryptionKey("too-short")).toBe(false);
    // 31 bytes (missing pad) and 33 bytes are both wrong byte counts.
    expect(isValidApiEncryptionKey("a".repeat(44))).toBe(false);
    expect(isValidApiEncryptionKey("a".repeat(43) + "=")).toBe(true);
    // A `!` isn't in the base64 alphabet.
    expect(isValidApiEncryptionKey("a".repeat(42) + "!=")).toBe(false);
  });
});

describe("isApiEncryptionKeyField", () => {
  it("is true only for api -> encryption.key", () => {
    expect(isApiEncryptionKeyField("api", ["encryption", "key"])).toBe(true);
    expect(isApiEncryptionKeyField("api", ["encryption", "port"])).toBe(false);
    expect(isApiEncryptionKeyField("wifi", ["encryption", "key"])).toBe(false);
    expect(isApiEncryptionKeyField("api", ["key"])).toBe(false);
  });
});
