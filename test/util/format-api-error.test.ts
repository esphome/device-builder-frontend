import { describe, expect, it } from "vitest";
import { APIError } from "../../src/api/index.js";
import { formatApiError } from "../../src/util/format-api-error.js";

// A localize stub that echoes its key back, so assertions can tell the
// fallback path (returns the key) apart from the structured-detail path.
const echo = (key: string) => `localized:${key}`;

describe("formatApiError", () => {
  it("prefers an APIError's structured details over the wire-form message", () => {
    // APIError.message is "<code>: <details>" — surfacing it would leak the
    // internal code into a dialog. The detail string is the user-facing copy.
    const err = new APIError("invalid_args", "Pin GPIO4 is already in use");
    expect(formatApiError(err, echo, "fallback.key")).toBe("Pin GPIO4 is already in use");
  });

  it("falls back to the localized key when an APIError carries no details", () => {
    // details defaults to "" for an undefined detail, so `details || localize`
    // takes the fallback branch rather than returning an empty string.
    const err = new APIError("rate_limited", undefined);
    expect(formatApiError(err, echo, "fallback.key")).toBe("localized:fallback.key");
  });

  it("falls back to the localized key when an APIError's details is empty", () => {
    const err = new APIError("rate_limited", "");
    expect(formatApiError(err, echo, "fallback.key")).toBe("localized:fallback.key");
  });

  it("uses a native Error's message", () => {
    expect(formatApiError(new Error("boom"), echo, "fallback.key")).toBe("boom");
  });

  it("falls back to the localized key for non-Error values", () => {
    expect(formatApiError("a bare string", echo, "fallback.key")).toBe(
      "localized:fallback.key"
    );
    expect(formatApiError(undefined, echo, "fallback.key")).toBe(
      "localized:fallback.key"
    );
    expect(formatApiError({ message: "not an Error" }, echo, "fallback.key")).toBe(
      "localized:fallback.key"
    );
  });
});
