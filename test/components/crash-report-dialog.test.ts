/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../_mock-webawesome.js";

vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const { copyToClipboard } = vi.hoisted(() => ({ copyToClipboard: vi.fn() }));
vi.mock("../../src/util/copy-to-clipboard.js", () => ({ copyToClipboard }));

const { downloadBlob } = vi.hoisted(() => ({ downloadBlob: vi.fn() }));
vi.mock("../../src/util/download-text.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  downloadBlob,
}));

import { ESPHomeCrashReportDialog } from "../../src/components/crash-report-dialog.js";
import type { StreamCallbacks } from "../../src/api/types/streaming.js";
import {
  CRASH_BLOCK as CRASH_LINES,
  VALIDATED_CONFIG_YAML,
  VALIDATE_OUTPUT,
} from "../_crash-lines.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

describe("crash-report-dialog", () => {
  let el: ESPHomeCrashReportDialog;
  let validateCallbacks: StreamCallbacks | null;
  let openedUrls: string[];

  beforeEach(() => {
    copyToClipboard.mockReset();
    downloadBlob.mockReset();
    validateCallbacks = null;
    openedUrls = [];
    vi.stubGlobal(
      "open",
      vi.fn((url: string) => {
        openedUrls.push(url);
        return {} as Window;
      })
    );
    el = new ESPHomeCrashReportDialog();
    (el as any)._api = {
      validate: (_config: string, callbacks: StreamCallbacks) => {
        validateCallbacks = callbacks;
        return "v1";
      },
      stopStream: vi.fn(() => Promise.resolve()),
    };
    document.body.appendChild(el);
  });

  afterEach(() => {
    // The stubbed `window.open` must not leak into other files in this worker.
    vi.unstubAllGlobals();
  });

  const finishValidate = (lines = VALIDATE_OUTPUT, success = true) => {
    for (const line of lines) validateCallbacks!.onOutput!(line);
    validateCallbacks!.onResult!({ success, code: success ? 0 : 1 });
  };

  const describe_ = (text: string) => {
    (el as any)._userDescription = text;
  };

  it("collects, filters CLI log noise out of the config, then goes ready", async () => {
    el.open("smallgarage.yaml", "Small Garage", CRASH_LINES);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".collecting")).not.toBeNull();

    finishValidate();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".collecting")).toBeNull();
    expect((el as any)._configYaml).toBe(VALIDATED_CONFIG_YAML);
  });

  it("degrades to a config-unavailable note when validation fails", async () => {
    el.open("smallgarage.yaml", "Small Garage", CRASH_LINES);
    finishValidate(["\\033[31mERROR something\\033[0m"], false);
    await el.updateComplete;
    expect((el as any)._configYaml).toBe("");
    expect((el as any)._configError).toBe("invalid");
    expect(el.shadowRoot!.querySelector(".collecting")).toBeNull();
    expect(el.shadowRoot!.textContent).toContain("crash_report.config_unavailable");
  });

  it("distinguishes a transport failure from an invalid config", async () => {
    el.open("smallgarage.yaml", "Small Garage", CRASH_LINES);
    validateCallbacks!.onError!("WebSocket not connected");
    await el.updateComplete;
    expect((el as any)._configYaml).toBe("");
    expect((el as any)._configError).toBe("transport");
    expect(el.shadowRoot!.textContent).toContain("crash_report.config_capture_failed");
    expect(el.shadowRoot!.textContent).not.toContain("crash_report.config_unavailable");
  });

  it("requires a description before the report can be opened", async () => {
    el.open("smallgarage.yaml", "Small Garage", CRASH_LINES);
    finishValidate();
    await el.updateComplete;
    const button = el.shadowRoot!.querySelector<HTMLButtonElement>(
      ".actions .btn--confirm"
    );
    expect(button!.disabled).toBe(true);

    describe_("Pressed the crash button");
    await el.updateComplete;
    expect(button!.disabled).toBe(false);
  });

  it("shows the write-in-English note whether or not a description is entered", async () => {
    el.open("smallgarage.yaml", "Small Garage", CRASH_LINES);
    finishValidate();
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain("crash_report.describe_english");

    describe_("Pressed the crash button");
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain("crash_report.describe_english");
  });

  it("always offers the manual issue link in the delivered state", async () => {
    // window.open with noopener returns null by spec even on success, so
    // the delivered state can't infer blocking; the link is always there.
    vi.stubGlobal(
      "open",
      vi.fn((url: string) => {
        openedUrls.push(url);
        return null;
      })
    );
    el.open("smallgarage.yaml", "Small Garage", CRASH_LINES);
    finishValidate();
    describe_("Pressed the crash button");
    await el.updateComplete;

    (el as any)._openIssue();
    await el.updateComplete;
    const anchor = el.shadowRoot!.querySelector<HTMLAnchorElement>(".actions a");
    expect(anchor!.href).toBe(openedUrls[0]);
    expect(anchor!.classList.contains("btn--confirm")).toBe(true);
  });

  it("degrades to config-unavailable when the validate stream stalls", async () => {
    vi.useFakeTimers();
    try {
      el.open("smallgarage.yaml", "Small Garage", CRASH_LINES);
      expect((el as any)._configYaml).toBeNull();
      vi.advanceTimersByTime(90_000);
      expect((el as any)._configYaml).toBe("");
      // A stall is a transport issue, not an invalid config.
      expect((el as any)._configError).toBe("transport");
      expect((el as any)._api.stopStream).toHaveBeenCalledWith("v1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops an abandoned validate stream on close and on re-open", () => {
    const stopStream = (el as any)._api.stopStream;
    el.open("smallgarage.yaml", "Small Garage", CRASH_LINES);
    (el as any)._onAfterHide();
    expect(stopStream).toHaveBeenCalledWith("v1");

    el.open("smallgarage.yaml", "Small Garage", CRASH_LINES);
    el.open("other.yaml", "Other", CRASH_LINES);
    expect(stopStream).toHaveBeenCalledTimes(2);
  });

  it("downloads the report, then opens the pre-filled issue", async () => {
    el.open("smallgarage.yaml", "Small Garage", CRASH_LINES);
    finishValidate();
    describe_("Pressed the crash button");
    await el.updateComplete;

    (el as any)._openIssue();
    // The full report is downloaded up front so the user always keeps it.
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    const reportText = downloadBlob.mock.calls[0][0] as string;
    expect(downloadBlob.mock.calls[0][1]).toBe("smallgarage-crash-report.md");
    expect(reportText).toContain("## What happened");
    expect(reportText.indexOf("## What happened")).toBeLessThan(
      reportText.indexOf("## Decoded backtrace")
    );
    expect(reportText).toContain("password: <removed>");

    expect(openedUrls).toHaveLength(1);
    const params = new URL(openedUrls[0]).searchParams;
    expect(openedUrls[0]).toContain("github.com/esphome/esphome/issues/new");
    // Config lands in the form's YAML Config box, backtrace in problem.
    expect(params.get("config")).toContain("password: <removed>");
    expect(params.get("problem")).toContain("Pressed the crash button");

    await el.updateComplete;
    expect((el as any)._dialog.open).toBe(true);
    expect((el as any)._delivered).toBe(true);
    const anchor = el.shadowRoot!.querySelector<HTMLAnchorElement>(".actions a");
    expect(anchor!.href).toBe(openedUrls[0]);

    // Copy-to-clipboard stays available on demand.
    copyToClipboard.mockResolvedValue(true);
    await (el as any)._copyReport();
    expect(copyToClipboard).toHaveBeenCalledWith(reportText);
  });

  it("ignores a stale validate result from a previous open", async () => {
    el.open("smallgarage.yaml", "Small Garage", CRASH_LINES);
    const stale = validateCallbacks!;
    el.open("other.yaml", "Other", CRASH_LINES);
    stale.onResult!({ success: false, code: 1 });
    await el.updateComplete;
    // Still collecting: the stale stream must not flip this session ready.
    expect((el as any)._configYaml).toBeNull();
  });

  it("keeps the new session's stall timer when a stale result arrives", () => {
    vi.useFakeTimers();
    try {
      el.open("smallgarage.yaml", "Small Garage", CRASH_LINES);
      const stale = validateCallbacks!;
      el.open("other.yaml", "Other", CRASH_LINES);
      // A late result from the previous session must not clear the new
      // session's stall timer (the shared instance-field hazard).
      stale.onResult!({ success: true, code: 0 });
      expect((el as any)._configYaml).toBeNull();
      vi.advanceTimersByTime(90_000);
      expect((el as any)._configYaml).toBe("");
      expect((el as any)._configError).toBe("transport");
    } finally {
      vi.useRealTimers();
    }
  });
});
/* eslint-enable @typescript-eslint/no-explicit-any */
