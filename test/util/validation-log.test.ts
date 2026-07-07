import { describe, expect, it } from "vitest";
import { isValidationFailureLine } from "../../src/util/validation-log.js";

describe("isValidationFailureLine", () => {
  it("matches the bare schema-validator banner", () => {
    expect(isValidationFailureLine("Failed config")).toBe(true);
  });

  it("matches the banner wrapped in SGR colour codes", () => {
    /* The dashboard stream pins the escaped ``\033`` form; the raw
       ESC-byte branch is defensive. Both must classify. */
    expect(isValidationFailureLine("\\033[1;31mFailed config\\033[0m")).toBe(true);
    expect(isValidationFailureLine("\u001b[1;31mFailed config\u001b[0m")).toBe(true);
  });

  it("matches the YAML-load ERROR line with and without a timestamp", () => {
    expect(
      isValidationFailureLine("ERROR Error while reading config: yaml scan error")
    ).toBe(true);
    expect(
      isValidationFailureLine("12:34:56 ERROR Error while reading config: bad key")
    ).toBe(true);
  });

  it("ignores ordinary log lines", () => {
    expect(isValidationFailureLine("INFO Compiling firmware")).toBe(false);
    expect(isValidationFailureLine("")).toBe(false);
  });

  it("ignores a line that merely quotes the markers mid-sentence", () => {
    /* LOADER_ERROR is anchored so a debug line that quotes the phrase
       can't match, and the banner check is exact-equality. */
    expect(
      isValidationFailureLine("DEBUG saw 'ERROR Error while reading config:' earlier")
    ).toBe(false);
    expect(isValidationFailureLine("Failed config parsing will retry")).toBe(false);
  });
});
