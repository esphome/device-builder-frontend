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
    expect(open).toHaveBeenCalledWith("smallgarage.yaml", "Small Garage", [
      "[I][app] boot",
      CRASH_LINE,
    ]);
  });
});
/* eslint-enable @typescript-eslint/no-explicit-any */
