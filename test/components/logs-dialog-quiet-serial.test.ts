/**
 * @vitest-environment happy-dom
 *
 * The quiet-serial escape hatch (#1430): a Web Serial session that shows
 * nothing for a few seconds offers switching to network logs in place.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { ESPHomeLogsDialog } from "../../src/components/logs-dialog.js";
import { switchToOtaLogs } from "../../src/components/logs-dialog/session.js";
import { OTA_PORT, type LogsSession } from "../../src/components/logs-session.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const session = (el: ESPHomeLogsDialog): LogsSession => (el as any)._session;
const call = (el: ESPHomeLogsDialog, method: string) => (el as any)[method]();
const banner = (el: ESPHomeLogsDialog): Element | null =>
  el.shadowRoot!.querySelector(".reset-suggestion");

describe("logs-dialog quiet-serial banner", () => {
  let el: ESPHomeLogsDialog;
  let logs: ReturnType<typeof vi.fn>;
  let cancel: ReturnType<typeof vi.fn>;
  const port = { close: vi.fn(), setSignals: vi.fn() } as unknown as SerialPort;

  beforeEach(() => {
    vi.useFakeTimers();
    el = new ESPHomeLogsDialog();
    logs = vi.fn(() => "stream-1");
    (el as any)._api = { logs, stopStream: vi.fn(() => Promise.resolve()) };
    cancel = vi.fn();
    document.body.appendChild(el);
  });

  afterEach(() => {
    el.remove();
    vi.useRealTimers();
  });

  async function startSerial(): Promise<void> {
    el.openPassive({ onReconnect: () => Promise.resolve() });
    el.setSerialStream(port, cancel as unknown as () => void);
    await el.updateComplete;
  }

  it("shows the banner after the quiet window with no serial lines", async () => {
    await startSerial();
    expect(banner(el)).toBeNull();
    vi.advanceTimersByTime(5000);
    await el.updateComplete;
    // Identity _localize in tests returns the key verbatim; the quiet branch
    // gets the tentative no-output-yet copy.
    expect(banner(el)!.textContent).toContain("dashboard.logs_no_serial_output");
  });

  it("stays hidden while serial lines keep arriving", async () => {
    await startSerial();
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(3000);
      call(el, "_noteSerialActivity");
    }
    await el.updateComplete;
    expect(banner(el)).toBeNull();
  });

  it("hides again when lines resume after going quiet", async () => {
    await startSerial();
    vi.advanceTimersByTime(5000);
    await el.updateComplete;
    expect(banner(el)).not.toBeNull();
    call(el, "_noteSerialActivity");
    await el.updateComplete;
    expect(banner(el)).toBeNull();
  });

  it("a deliberate Stop (pause) never counts as silence", async () => {
    await startSerial();
    call(el, "_onStop");
    await el.updateComplete;
    vi.advanceTimersByTime(60_000);
    await el.updateComplete;
    expect(banner(el)).toBeNull();
    // Start re-arms a fresh window rather than firing instantly.
    call(el, "_onStart");
    await el.updateComplete;
    expect(banner(el)).toBeNull();
    vi.advanceTimersByTime(5000);
    await el.updateComplete;
    expect(banner(el)).not.toBeNull();
  });

  it("does not count the reopen wait (reconnecting) as silence", async () => {
    // The settle delay + re-enumeration reopen retries can run for seconds on
    // a healthy native-USB board; the window must start at reader attach.
    el.openPassive({ onReconnect: () => Promise.resolve() });
    await el.updateComplete;
    vi.advanceTimersByTime(60_000);
    await el.updateComplete;
    expect(banner(el)).toBeNull();
    el.setSerialStream(port, cancel as unknown as () => void);
    await el.updateComplete;
    vi.advanceTimersByTime(4999);
    await el.updateComplete;
    expect(banner(el)).toBeNull();
    vi.advanceTimersByTime(1);
    await el.updateComplete;
    expect(banner(el)).not.toBeNull();
  });

  it("shows the banner immediately for a dead session (reopen failed)", async () => {
    el.openPassive({ onReconnect: () => Promise.resolve() });
    el.setSerialOpenFailed("reopen failed");
    await el.updateComplete;
    // The dead branch is a failed/dismissed port, not a silent console — it
    // gets the neutral serial-unavailable copy.
    expect(banner(el)!.textContent).toContain("dashboard.logs_serial_unavailable");
  });

  it("never arms for an OTA session", async () => {
    el.open(OTA_PORT);
    await el.updateComplete;
    vi.advanceTimersByTime(60_000);
    await el.updateComplete;
    expect(banner(el)).toBeNull();
  });

  it("clicking the banner switches the same dialog to network logs", async () => {
    await startSerial();
    vi.advanceTimersByTime(5000);
    await el.updateComplete;
    (banner(el)!.querySelector(".reset-suggestion-link") as HTMLElement).click();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(session(el)).toMatchObject({ kind: "ota", port: OTA_PORT });
    expect(logs).toHaveBeenCalledTimes(1);
    await el.updateComplete;
    expect(banner(el)).toBeNull();
  });

  it("closing the dialog cancels the pending window", async () => {
    await startSerial();
    call(el, "_onDialogHide");
    await el.updateComplete;
    vi.advanceTimersByTime(60_000);
    await el.updateComplete;
    expect(banner(el)).toBeNull();
  });
});

describe("switchToOtaLogs", () => {
  let el: ESPHomeLogsDialog;
  let logs: ReturnType<typeof vi.fn>;
  const port = { close: vi.fn(), setSignals: vi.fn() } as unknown as SerialPort;

  beforeEach(() => {
    el = new ESPHomeLogsDialog();
    logs = vi.fn(() => "stream-1");
    (el as any)._api = { logs, stopStream: vi.fn(() => Promise.resolve()) };
    (el as any)._open = true;
  });

  it("tears down the serial reader and starts the OTA stream in place", () => {
    const cancel = vi.fn();
    el.openPassive({ onReconnect: () => Promise.resolve() });
    el.setSerialStream(port, cancel as unknown as () => void);
    (el as any)._log.append(["boot garbage"]);

    switchToOtaLogs(el);

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(session(el)).toMatchObject({ kind: "ota", port: OTA_PORT });
    expect(logs).toHaveBeenCalledTimes(1);
    // The buffer survives: boot context plus the transition line.
    expect((el as any)._log.lines).toEqual([
      "boot garbage",
      "dashboard.logs_switched_to_network",
    ]);
  });

  it("keeps the back-to-install affordance across the switch", () => {
    el.openPassive({
      onReconnect: () => Promise.resolve(),
      onBackToInstall: () => {},
    });
    el.setSerialStream(port, vi.fn() as unknown as () => void);
    switchToOtaLogs(el);
    expect((el as any)._backToInstall).toBe(true);
  });

  it("switches from a dead session", () => {
    el.openPassive({ onReconnect: () => Promise.resolve() });
    el.setSerialOpenFailed("reopen failed");
    switchToOtaLogs(el);
    expect(session(el)).toMatchObject({ kind: "ota", port: OTA_PORT });
    expect(logs).toHaveBeenCalledTimes(1);
  });

  it("is a no-op from an OTA or idle session (double-click safe)", () => {
    el.open(OTA_PORT);
    expect(logs).toHaveBeenCalledTimes(1);
    switchToOtaLogs(el);
    expect(logs).toHaveBeenCalledTimes(1); // no second stream

    call(el, "_onDialogHide"); // -> idle
    logs.mockClear();
    switchToOtaLogs(el);
    expect(logs).not.toHaveBeenCalled();
    expect(session(el).kind).toBe("idle");
  });

  it("absorbs a late serial attach after the switch (no leaked port)", () => {
    el.openPassive({ onReconnect: () => Promise.resolve() });
    switchToOtaLogs(el); // switched while the attach was still in flight
    const lateCancel = vi.fn();
    el.setSerialStream(port, lateCancel as unknown as () => void);
    expect(lateCancel).toHaveBeenCalledTimes(1);
    expect(session(el)).toMatchObject({ kind: "ota", port: OTA_PORT });
  });
});
/* eslint-enable @typescript-eslint/no-explicit-any */
