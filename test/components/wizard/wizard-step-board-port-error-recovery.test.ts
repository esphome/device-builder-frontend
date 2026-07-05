/**
 * @vitest-environment happy-dom
 *
 * An initial port-list fetch failure must not pin the wizard on the
 * error view: when a later poll succeeds, the recovered list shows,
 * while a chip-detect error keeps its own lifecycle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/badge/badge.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));

import type { SerialPort } from "../../../src/api/types/system.js";
import { defaultLocalize } from "../../../src/common/localize.js";
import type { ESPHomeWizardStepBoardPortSelect } from "../../../src/components/wizard/wizard-step-board-port-select.js";
import { ESPHomeWizardStepBoard } from "../../../src/components/wizard/wizard-step-board.js";
import { SERIAL_PORTS_POLL_INTERVAL_MS } from "../../../src/util/serial-ports-poll-controller.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function mount(getSerialPorts: () => Promise<SerialPort[]>) {
  const el = new ESPHomeWizardStepBoard();
  (el as any)._localize = defaultLocalize;
  (el as any)._api = {
    getBoards: async () => ({ boards: [] }),
    getSerialPorts,
  };
  document.body.appendChild(el);
  await el.updateComplete;
  (el as any)._view = "select-port";
  await el.updateComplete;
  return el;
}

const portSelect = (el: ESPHomeWizardStepBoard) =>
  el.shadowRoot!.querySelector(
    "esphome-wizard-step-board-port-select"
  ) as ESPHomeWizardStepBoardPortSelect;
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("wizard-step-board port fetch error recovery", () => {
  it("clears the error and shows the list once a later poll succeeds", async () => {
    let fail = true;
    const getSerialPorts = vi.fn(async () => {
      if (fail) throw new Error("backend offline");
      return [{ port: "/dev/ttyUSB0", desc: "CP2102" }];
    });
    const el = await mount(getSerialPorts);

    await vi.advanceTimersByTimeAsync(0);
    await el.updateComplete;
    expect(portSelect(el).errorMessage).toBe("backend offline");

    fail = false;
    await vi.advanceTimersByTimeAsync(SERIAL_PORTS_POLL_INTERVAL_MS);
    await el.updateComplete;
    expect(portSelect(el).errorMessage).toBe("");
    expect(portSelect(el).ports).toEqual([{ port: "/dev/ttyUSB0", desc: "CP2102" }]);
  });
});
