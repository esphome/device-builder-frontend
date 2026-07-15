/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
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
import { CRASH_BLOCK as CRASH_LINES } from "../_crash-lines.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const VALIDATE_OUTPUT = [
  "\\033[32mINFO ESPHome 2026.6.4\\033[0m",
  "\\033[32mINFO Reading configuration smallgarage.yaml...\\033[0m",
  "esphome:",
  "  name: smallgarage",
  "wifi:",
  "  password: <removed>",
  "\\033[32mINFO Configuration is valid!\\033[0m",
];

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
        return null;
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

  const finishValidate = (lines = VALIDATE_OUTPUT, success = true) => {
    for (const line of lines) validateCallbacks!.onOutput!(line);
    validateCallbacks!.onResult!({ success, code: success ? 0 : 1 });
  };

  it("collects, filters CLI log noise out of the config, then goes ready", async () => {
    el.open("smallgarage.yaml", "Small Garage", CRASH_LINES);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".collecting")).not.toBeNull();

    finishValidate();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".collecting")).toBeNull();
    expect((el as any)._configYaml).toBe(
      "esphome:\n  name: smallgarage\nwifi:\n  password: <removed>"
    );
  });

  it("degrades to a config-unavailable note when validation fails", async () => {
    el.open("smallgarage.yaml", "Small Garage", CRASH_LINES);
    finishValidate(["\\033[31mERROR something\\033[0m"], false);
    await el.updateComplete;
    expect((el as any)._configYaml).toBe("");
    expect(el.shadowRoot!.querySelector(".collecting")).toBeNull();
    expect(el.shadowRoot!.textContent).toContain("crash_report.config_unavailable");
  });

  it("degrades to config-unavailable when the validate stream stalls", async () => {
    vi.useFakeTimers();
    try {
      el.open("smallgarage.yaml", "Small Garage", CRASH_LINES);
      expect((el as any)._configYaml).toBeNull();
      vi.advanceTimersByTime(90_000);
      expect((el as any)._configYaml).toBe("");
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

  it("copies the full report and opens the pre-filled issue", async () => {
    copyToClipboard.mockResolvedValue(true);
    el.open("smallgarage.yaml", "Small Garage", CRASH_LINES);
    finishValidate();
    await el.updateComplete;

    await (el as any)._copyAndOpen();
    expect(copyToClipboard).toHaveBeenCalledTimes(1);
    const reportText = copyToClipboard.mock.calls[0][0] as string;
    expect(reportText).toContain("## Decoded backtrace");
    expect(reportText.indexOf("## Decoded backtrace")).toBeLessThan(
      reportText.indexOf("## Configuration")
    );
    expect(reportText).toContain("password: <removed>");
    expect(openedUrls).toHaveLength(1);
    expect(openedUrls[0]).toContain("github.com/esphome/esphome/issues/new");
    expect(new URL(openedUrls[0]).searchParams.get("additional")).toContain("clipboard");

    // The dialog stays open in the delivered state so a clipboard lost to
    // the tab switch can be re-copied (or downloaded) without redoing the
    // validate round-trip.
    await el.updateComplete;
    expect((el as any)._dialog.open).toBe(true);
    expect((el as any)._delivered).toBe(true);

    await (el as any)._copyAgain();
    expect(copyToClipboard).toHaveBeenCalledTimes(2);
    expect(copyToClipboard.mock.calls[1][0]).toBe(reportText);

    (el as any)._downloadReport();
    expect(downloadBlob).toHaveBeenCalledWith(
      reportText,
      "smallgarage-crash-report.md",
      "text/markdown"
    );
  });

  it("falls back to a report download when the copy fails", async () => {
    copyToClipboard.mockResolvedValue(false);
    el.open("smallgarage.yaml", "Small Garage", CRASH_LINES);
    finishValidate();
    await el.updateComplete;

    await (el as any)._copyAndOpen();
    expect(openedUrls).toHaveLength(0); // no tab until the report is delivered
    await el.updateComplete;
    expect((el as any)._copyFailed).toBe(true);

    (el as any)._downloadAndOpen();
    expect(downloadBlob).toHaveBeenCalledWith(
      expect.stringContaining("## Decoded backtrace"),
      "smallgarage-crash-report.md",
      "text/markdown"
    );
    expect(openedUrls).toHaveLength(1);
    expect(new URL(openedUrls[0]).searchParams.get("additional")).toContain(
      "markdown file"
    );
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
});
/* eslint-enable @typescript-eslint/no-explicit-any */
