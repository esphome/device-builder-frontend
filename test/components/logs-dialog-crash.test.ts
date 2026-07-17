/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeLogsDialog } from "../../src/components/logs-dialog.js";
import { CRASH_BANNER_LINE as CRASH_LINE } from "../_crash-lines.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const append = (el: ESPHomeLogsDialog, lines: string[]) =>
  (el as any)._appendCapped(lines);

describe("logs-dialog crash callout", () => {
  let el: ESPHomeLogsDialog;

  beforeEach(() => {
    el = new ESPHomeLogsDialog();
    (el as any)._api = { logs: () => "s1", stopStream: () => Promise.resolve() };
    document.body.appendChild(el);
  });

  const callout = () => el.shadowRoot!.querySelector(".crash-callout");

  it("appears once a crash line flows through the append path", async () => {
    el.open("OTA");
    await el.updateComplete;
    append(el, ["[12:00:00][I][app:029]: boot"]);
    await el.updateComplete;
    expect(callout()).toBeNull();

    append(el, [CRASH_LINE]);
    await el.updateComplete;
    expect(callout()).not.toBeNull();
    expect(callout()!.querySelector("button")).not.toBeNull();
  });

  it("persists after the crash lines scroll out of the capped buffer", async () => {
    el.open("OTA");
    append(el, [CRASH_LINE]);
    append(
      el,
      Array.from({ length: 6000 }, (_, i) => `line ${i}`)
    );
    await el.updateComplete;
    expect(callout()).not.toBeNull();
  });

  it("clears on a new session", async () => {
    el.open("OTA");
    append(el, [CRASH_LINE]);
    await el.updateComplete;
    expect(callout()).not.toBeNull();

    el.open("OTA");
    await el.updateComplete;
    expect(callout()).toBeNull();
  });

  it("clears when the user clears the log", async () => {
    el.open("OTA");
    append(el, [CRASH_LINE]);
    await el.updateComplete;
    (el as any)._clearLogs();
    await el.updateComplete;
    expect(callout()).toBeNull();
  });

  it("hands the report dialog a snapshot of the buffer on click", async () => {
    el.open("OTA");
    append(el, ["[I][app] boot", CRASH_LINE]);
    await el.updateComplete;
    const open = vi.fn();
    Object.defineProperty(el, "_crashReportDialog", { value: { open } });
    el.configuration = "smallgarage.yaml";
    el.name = "Small Garage";
    callout()!.querySelector("button")!.click();
    // The stale-build verdict rides along as a value; the report captions
    // its frames from it rather than re-reading the log it came from.
    expect(open).toHaveBeenCalledWith(
      "smallgarage.yaml",
      "Small Garage",
      ["[I][app] boot", CRASH_LINE],
      false
    );
  });

  describe("kind classification", () => {
    const kind = (el: ESPHomeLogsDialog) => (el as any)._crashKind;

    it("stays null until a marker arrives", () => {
      append(el, ["[12:00:00][I][app:029]: boot"]);

      expect(kind(el)).toBeNull();
    });

    it("spots a live crash wrapped in ANSI and a timestamp", () => {
      append(el, [
        "[12:00:00][I][app:029]: boot",
        `[1;31m[12:00:01]Guru Meditation Error: Core 1 panic'ed (StoreProhibited).[0m`,
      ]);

      expect(kind(el)).toBe("live");
    });

    it("classifies the crash handler's boot replay as previous-boot", () => {
      append(el, [
        "[11:21:19.093][E][esp32.crash:332]: *** CRASH DETECTED ON PREVIOUS BOOT ***",
        "[11:21:19.167][E][esp32.crash:305]:   BT0: 0x4015482D  (backtrace)",
      ]);

      expect(kind(el)).toBe("previous-boot");
    });

    it("lets live win when both kinds arrive in one batch", () => {
      append(el, [
        "[E][esp32.crash:332]: *** CRASH DETECTED ON PREVIOUS BOOT ***",
        CRASH_LINE,
      ]);

      expect(kind(el)).toBe("live");
    });

    it("lets live win even when the replay follows it in the same batch", () => {
      // Order matters: last-one-wins would answer previous-boot here, and the
      // device replaying an older crash after panicking doesn't make the panic
      // the lesser event.
      append(el, [
        CRASH_LINE,
        "[E][esp32.crash:332]: *** CRASH DETECTED ON PREVIOUS BOOT ***",
      ]);

      expect(kind(el)).toBe("live");
    });

    it("does not let a later previous-boot replay downgrade a live crash", () => {
      append(el, [CRASH_LINE]);
      append(el, ["[E][esp32.crash:332]: *** CRASH DETECTED ON PREVIOUS BOOT ***"]);

      // The device rebooted and replayed the crash it just took; the report
      // should still offer the live one.
      expect(kind(el)).toBe("live");
    });
  });
});
/* eslint-enable @typescript-eslint/no-explicit-any */
