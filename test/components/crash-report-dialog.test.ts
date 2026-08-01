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

import {
  CRASH_BLOCK_NOISE_ONLY,
  CRASH_BLOCK as CRASH_LINES,
  MASKED_CONFIG_YAML,
  RAW_CONFIG_YAML,
} from "../_crash-lines.js";
import { flushMicrotasks } from "../_dom.js";
import { APIError } from "../../src/api/api-error.js";
import { ESPHomeCrashReportDialog } from "../../src/components/crash-report-dialog.js";
import { MAX_TITLE_LENGTH } from "../../src/util/crash-report-title.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Deferred {
  resolve: (yaml: string) => void;
  reject: (err: unknown) => void;
}

describe("crash-report-dialog", () => {
  let el: ESPHomeCrashReportDialog;
  let reads: Deferred[];
  let openedUrls: string[];

  beforeEach(() => {
    copyToClipboard.mockReset();
    downloadBlob.mockReset();
    reads = [];
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
      getConfig: vi.fn(
        () =>
          new Promise<string>((resolve, reject) => {
            reads.push({ resolve, reject });
          })
      ),
    };
    document.body.appendChild(el);
  });

  afterEach(() => {
    // The stubbed `window.open` must not leak into other files in this worker.
    vi.unstubAllGlobals();
  });

  // Drain microtask turns until *predicate* holds (capped), so the
  // helpers don't pin exact hop counts of the recovery util's await
  // chain — a refactor there must not read as a dialog failure.
  const settle = async (predicate: () => boolean) => {
    for (let i = 0; i < 20 && !predicate(); i++) await flushMicrotasks(1);
  };

  const finishRead = async (yaml = RAW_CONFIG_YAML) => {
    await settle(() => reads.length > 0);
    reads[reads.length - 1]!.resolve(yaml);
    await settle(() => (el as any)._configYaml !== null);
  };

  const rejectRead = async () => {
    await settle(() => reads.length > 0);
    // An APIError is final for the recovery util; a bare transport error
    // would park in its real-timer retry backoff instead.
    reads[reads.length - 1]!.reject(new APIError("internal_error", "boom"));
    await settle(() => (el as any)._configYaml !== null);
  };

  const describe_ = (text: string) => {
    (el as any)._userDescription = text;
  };

  const title_ = (text: string) => {
    (el as any)._userTitle = text;
  };

  it("reads the config, masks its credentials, then goes ready", async () => {
    el.open("smallgarage.yaml", "Small Garage", CRASH_LINES);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".collecting")).not.toBeNull();

    await finishRead();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".collecting")).toBeNull();
    expect((el as any)._configYaml).toBe(MASKED_CONFIG_YAML);
  });

  it("includes the config even when esphome would reject it", async () => {
    // The raw file read has no validation step, so a config that fails
    // `esphome config` still lands in the report.
    el.open("smallgarage.yaml", "Small Garage", CRASH_LINES);
    await finishRead("esphome:\n  nam broken [yaml");
    await el.updateComplete;
    expect((el as any)._configYaml).toBe("esphome:\n  nam broken [yaml");
    expect(el.shadowRoot!.textContent).toContain("crash_report.includes_config");
  });

  it("degrades to the no-config path when the read fails", async () => {
    el.open("smallgarage.yaml", "Small Garage", CRASH_LINES);
    await rejectRead();
    await el.updateComplete;
    expect((el as any)._configYaml).toBe("");
    expect(el.shadowRoot!.textContent).toContain("crash_report.config_capture_failed");
    expect(el.shadowRoot!.textContent).not.toContain("crash_report.includes_config");
  });

  it("requires a description before the report can be opened", async () => {
    el.open("smallgarage.yaml", "Small Garage", CRASH_LINES);
    await finishRead();
    await el.updateComplete;
    const button = el.shadowRoot!.querySelector<HTMLButtonElement>(
      ".actions .btn--confirm"
    );
    expect(button!.disabled).toBe(true);

    describe_("Pressed the crash button");
    await el.updateComplete;
    expect(button!.disabled).toBe(false);
  });

  it("seeds the title from the crash location on open", async () => {
    el.open("smallgarage.yaml", "Small Garage", CRASH_LINES);
    await finishRead();
    await el.updateComplete;
    expect((el as any)._userTitle).toBe("Device: crash in Application::setup");
    const input = el.shadowRoot!.querySelector<HTMLInputElement>("#crash-title");
    expect(input!.value).toBe("Device: crash in Application::setup");
    expect(el.shadowRoot!.textContent).toContain("crash_report.title_note");
    expect(el.shadowRoot!.textContent).not.toContain("crash_report.title_note_undecoded");
  });

  it("points the title field at its error while it is rejected", async () => {
    el.open("smallgarage.yaml", "Small Garage", CRASH_BLOCK_NOISE_ONLY);
    await finishRead();
    await el.updateComplete;
    const input = () => el.shadowRoot!.querySelector<HTMLInputElement>("#crash-title")!;
    // A field that only points at its note leaves a screen-reader user with
    // no way to reach why the confirm button is disabled.
    expect(input().getAttribute("aria-invalid")).toBe("true");
    expect(input().getAttribute("aria-describedby")).toBe(
      "crash-title-note crash-title-error"
    );
    expect(el.shadowRoot!.querySelector("#crash-title-error")).not.toBeNull();

    title_("BLE scan reboots the ESP32");
    await el.updateComplete;
    // aria-invalid stays present and reads "false" — the boolean binding
    // would drop the attribute entirely.
    expect(input().getAttribute("aria-invalid")).toBe("false");
    expect(input().getAttribute("aria-describedby")).toBe("crash-title-note");
  });

  it("requires a title when no frame decoded to one worth naming", async () => {
    el.open("smallgarage.yaml", "Small Garage", CRASH_BLOCK_NOISE_ONLY);
    await finishRead();
    describe_("Pressed the crash button");
    await el.updateComplete;
    const button = el.shadowRoot!.querySelector<HTMLButtonElement>(
      ".actions .btn--confirm"
    );
    // Described but untitled: the seed found nothing, so the user types it.
    expect((el as any)._userTitle).toBe("");
    expect(button!.disabled).toBe(true);
    expect(el.shadowRoot!.textContent).toContain("crash_report.title_required");
    // The note must not claim a suggestion in the case it was added for.
    expect(el.shadowRoot!.textContent).toContain("crash_report.title_note_undecoded");

    // A one-word title is no better than the generic one it replaces, and
    // it gets its own message: repeating the empty-field wording leaves the
    // user retyping variations with no hint that length is the problem.
    title_("crash");
    await el.updateComplete;
    expect(button!.disabled).toBe(true);
    expect(el.shadowRoot!.textContent).toContain("crash_report.title_too_short");
    expect(el.shadowRoot!.textContent).not.toContain("crash_report.title_required");

    title_("BLE scan reboots the ESP32");
    await el.updateComplete;
    expect(button!.disabled).toBe(false);
  });

  it("caps the title input at what the issue builder accepts", async () => {
    // A maxlength above the builder's clamp would silently truncate a title
    // the user could see themselves typing in full.
    el.open("smallgarage.yaml", "Small Garage", CRASH_LINES);
    await finishRead();
    await el.updateComplete;
    const input = el.shadowRoot!.querySelector<HTMLInputElement>("#crash-title");
    expect(input!.maxLength).toBe(MAX_TITLE_LENGTH);
  });

  it("carries the edited title into the issue URL", async () => {
    el.open("smallgarage.yaml", "Small Garage", CRASH_LINES);
    await finishRead();
    describe_("Pressed the crash button");
    title_("BLE scan reboots the ESP32");
    await el.updateComplete;

    (el as any)._openIssue();
    expect(new URL(openedUrls[0]).searchParams.get("title")).toBe(
      "BLE scan reboots the ESP32"
    );
  });

  it("re-seeds the title when a second crash opens the dialog", () => {
    el.open("smallgarage.yaml", "Small Garage", CRASH_BLOCK_NOISE_ONLY);
    expect((el as any)._userTitle).toBe("");
    el.open("other.yaml", "Other", CRASH_LINES);
    expect((el as any)._userTitle).toBe("Device: crash in Application::setup");
  });

  it("shows the write-in-English note whether or not a description is entered", async () => {
    el.open("smallgarage.yaml", "Small Garage", CRASH_LINES);
    await finishRead();
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
    await finishRead();
    describe_("Pressed the crash button");
    await el.updateComplete;

    (el as any)._openIssue();
    await el.updateComplete;
    const anchor = el.shadowRoot!.querySelector<HTMLAnchorElement>(".actions a");
    expect(anchor!.href).toBe(openedUrls[0]);
    expect(anchor!.classList.contains("btn--confirm")).toBe(true);
  });

  it("downloads the report, then opens the pre-filled issue", async () => {
    el.open("smallgarage.yaml", "Small Garage", CRASH_LINES);
    await finishRead();
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
    expect(reportText).toContain("password: •");

    expect(openedUrls).toHaveLength(1);
    const params = new URL(openedUrls[0]).searchParams;
    expect(openedUrls[0]).toContain("github.com/esphome/esphome/issues/new");
    // Config lands in the form's YAML Config box, backtrace in problem.
    expect(params.get("config")).toContain("password: •");
    expect(params.get("config")).not.toContain("hunter2");
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

  it("gives up on a parked config read after the wall-clock timeout", async () => {
    vi.useFakeTimers();
    try {
      el.open("smallgarage.yaml", "Small Garage", CRASH_LINES);
      // The read never settles (socket down); the dialog must not stay
      // on the collecting spinner forever — the report is filable
      // without config.
      await vi.advanceTimersByTimeAsync(30_000);
      expect((el as any)._configYaml).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a stale config read from a previous open", async () => {
    el.open("smallgarage.yaml", "Small Garage", CRASH_LINES);
    await settle(() => reads.length > 0);
    const stale = reads[0]!;
    el.open("other.yaml", "Other", CRASH_LINES);
    stale.resolve("esphome:\n  name: smallgarage");
    await flushMicrotasks(10);
    await el.updateComplete;
    // Still collecting: the stale read must not flip this session ready.
    expect((el as any)._configYaml).toBeNull();
  });
});
/* eslint-enable @typescript-eslint/no-explicit-any */
