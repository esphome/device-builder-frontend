/**
 * Tests for ``lintFailureMessageFromResponse`` — the pure
 * response → display-message reducer the device editor uses
 * to decide whether to bail on save.
 *
 * Two empty-string cases the device editor's ``_onSave`` flow
 * has to keep apart, both pinned here:
 *
 *   - No errors → ``null`` (save proceeds).
 *   - Error reported but message is empty/whitespace → fall back
 *     to the caller-supplied label so ``_onSave`` blocks AND
 *     the rendered error ``<p>`` shows something.
 */
import { describe, expect, it } from "vitest";
import type { EditorValidateResponse } from "../../src/api/types.js";
import { lintFailureMessageFromResponse } from "../../src/util/lint-failure-message.js";

const FALLBACK = "Failed to save section";

function res(overrides: Partial<EditorValidateResponse> = {}): EditorValidateResponse {
  return {
    yaml_errors: [],
    validation_errors: [],
    ...overrides,
  };
}

describe("lintFailureMessageFromResponse", () => {
  it("returns null when both error arrays are empty", () => {
    expect(lintFailureMessageFromResponse(res(), FALLBACK)).toBe(null);
  });

  it("returns the validation message when present and non-empty", () => {
    const out = lintFailureMessageFromResponse(
      res({
        validation_errors: [
          { message: "Invalid foo bar" } as never,
        ],
      }),
      FALLBACK,
    );
    expect(out).toBe("Invalid foo bar");
  });

  it("trims surrounding whitespace from a real validation message", () => {
    const out = lintFailureMessageFromResponse(
      res({
        validation_errors: [
          { message: "  Invalid foo bar\n" } as never,
        ],
      }),
      FALLBACK,
    );
    // No leading / trailing whitespace bleeds into the rendered
    // ``<p>`` — keeps the error block tidy regardless of how
    // ESPHome formats its messages.
    expect(out).toBe("Invalid foo bar");
  });

  it("falls back to the caller-supplied label when validation message trims empty", () => {
    // Critical bail-vs-proceed pivot: the backend reported a
    // validation_error, but the message string was just
    // whitespace. Without the fallback the helper would return
    // ``null`` and ``_onSave`` would proceed past a real
    // validation failure. Fallback keeps the save blocked.
    const out = lintFailureMessageFromResponse(
      res({
        validation_errors: [
          { message: "   \n\t  " } as never,
        ],
      }),
      FALLBACK,
    );
    expect(out).toBe(FALLBACK);
  });

  it("falls back to the caller-supplied label when validation message is undefined", () => {
    // Same bail behaviour for the missing-message shape (e.g.
    // a future backend response that only carries a code +
    // location and forgets the human label).
    const out = lintFailureMessageFromResponse(
      res({
        validation_errors: [
          { message: undefined as unknown as string } as never,
        ],
      }),
      FALLBACK,
    );
    expect(out).toBe(FALLBACK);
  });

  it("returns the yaml_errors message when no validation errors", () => {
    // Validation errors take priority — but yaml-syntax errors
    // are also a real failure and should bail.
    const out = lintFailureMessageFromResponse(
      res({
        yaml_errors: [
          { message: "Unexpected token" } as never,
        ],
      }),
      FALLBACK,
    );
    expect(out).toBe("Unexpected token");
  });

  it("falls back when yaml_errors message trims empty", () => {
    const out = lintFailureMessageFromResponse(
      res({
        yaml_errors: [
          { message: "  " } as never,
        ],
      }),
      FALLBACK,
    );
    expect(out).toBe(FALLBACK);
  });

  it("validation errors win over yaml errors", () => {
    // Both populated — pin priority so a regression that
    // swapped the order would surface.
    const out = lintFailureMessageFromResponse(
      res({
        validation_errors: [
          { message: "validation wins" } as never,
        ],
        yaml_errors: [
          { message: "yaml loses" } as never,
        ],
      }),
      FALLBACK,
    );
    expect(out).toBe("validation wins");
  });
});
