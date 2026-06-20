/**
 * Tests for ``onPreviewSubmit`` step routing. A successful preview captures
 * the pin and advances to ``confirm``; a failed preview drops back to
 * ``input`` (so an auto-preview that jumped straight to ``confirm`` returns
 * the user to the pre-filled form to retry).
 */
import { describe, expect, it, vi } from "vitest";
import type { ESPHomePairBuildServerDialog } from "../../../src/components/pair-build-server-dialog.js";
import { onPreviewSubmit } from "../../../src/components/pair-build-server-dialog/actions.js";

function makeHost(
  preview: () => Promise<{ pin_sha256: string }>
): ESPHomePairBuildServerDialog {
  return {
    _localize: (key: string) => key,
    _api: { previewRemoteBuildPair: preview },
    _busy: false,
    _hostname: "buildbox.local",
    _port: "6055",
    _previewedPin: "",
    _error: null,
    _step: "confirm",
    _skippedInput: true,
  } as unknown as ESPHomePairBuildServerDialog;
}

describe("onPreviewSubmit", () => {
  it("captures the pin and advances to the confirm step on success", async () => {
    const host = makeHost(async () => ({ pin_sha256: "abc123" }));
    await onPreviewSubmit(host);

    expect(host._previewedPin).toBe("abc123");
    expect(host._step).toBe("confirm");
    expect(host._error).toBeNull();
  });

  it("falls back to the input step on a failed preview", async () => {
    const host = makeHost(() => Promise.reject(new Error("unreachable")));
    await onPreviewSubmit(host);

    expect(host._step).toBe("input");
    expect(host._previewedPin).toBe("");
    expect(host._error).not.toBeNull();
    // Form is now shown, so a later Back from confirm goes to input, not close.
    expect(host._skippedInput).toBe(false);
  });

  it("recovers to the input step on invalid input without calling the API", async () => {
    const preview = vi.fn(async () => ({ pin_sha256: "x" }));
    const host = makeHost(preview);
    host._hostname = "";
    await onPreviewSubmit(host);

    expect(preview).not.toHaveBeenCalled();
    expect(host._step).toBe("input");
    expect(host._skippedInput).toBe(false);
    expect(host._error).toBe("settings.pair_build_server_input_invalid");
  });
});
