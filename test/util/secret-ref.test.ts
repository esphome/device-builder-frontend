import { describe, expect, it } from "vitest";
import { isSecretRef, secretRefKey } from "../../src/util/secret-ref.js";

describe("secretRefKey", () => {
  it("extracts the key from a !secret reference", () => {
    expect(secretRefKey("!secret wifi_password")).toBe("wifi_password");
  });

  it("tolerates extra inner whitespace and trailing whitespace", () => {
    expect(secretRefKey("!secret   api_key")).toBe("api_key");
    expect(secretRefKey("!secret api_key   ")).toBe("api_key");
  });

  it("returns null for a literal value", () => {
    expect(secretRefKey("plain_value")).toBeNull();
    expect(secretRefKey("")).toBeNull();
  });

  it("returns null when the tag has no key", () => {
    expect(secretRefKey("!secret")).toBeNull();
    expect(secretRefKey("!secret ")).toBeNull();
  });

  it("returns null when more than one token follows the tag", () => {
    // A single-key reference only — `key extra` is not a valid !secret ref.
    expect(secretRefKey("!secret key extra")).toBeNull();
  });
});

describe("isSecretRef", () => {
  it("is true for a well-formed reference", () => {
    expect(isSecretRef("!secret wifi_password")).toBe(true);
    expect(isSecretRef("!secret   api_key  ")).toBe(true);
  });

  it("is false for literals and malformed tags", () => {
    expect(isSecretRef("plain_value")).toBe(false);
    expect(isSecretRef("!secret")).toBe(false);
    expect(isSecretRef("!secret key extra")).toBe(false);
    expect(isSecretRef("")).toBe(false);
  });
});
