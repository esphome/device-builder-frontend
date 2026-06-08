import { describe, expect, it } from "vitest";

import { getErrorMessage } from "../../src/util/error-message.js";

describe("getErrorMessage", () => {
  it("returns the message of an Error instance", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns the message of an Error subclass", () => {
    class WsError extends Error {}
    expect(getErrorMessage(new WsError("disconnected"))).toBe("disconnected");
  });

  it("preserves an empty Error message verbatim", () => {
    expect(getErrorMessage(new Error(""))).toBe("");
  });

  it("stringifies a thrown string", () => {
    expect(getErrorMessage("plain failure")).toBe("plain failure");
  });

  it("stringifies a thrown number", () => {
    expect(getErrorMessage(42)).toBe("42");
  });

  it("stringifies null and undefined", () => {
    expect(getErrorMessage(null)).toBe("null");
    expect(getErrorMessage(undefined)).toBe("undefined");
  });

  it("stringifies a plain object rejection", () => {
    expect(getErrorMessage({ code: 500 })).toBe("[object Object]");
  });
});
