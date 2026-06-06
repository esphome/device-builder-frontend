import { describe, expect, it } from "vitest";
import { generateApiEncryptionKey } from "../../src/util/api-encryption-key.js";

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
