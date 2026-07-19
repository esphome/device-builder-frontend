/**
 * @vitest-environment happy-dom
 *
 * The "Select a serial port" view must refresh while the dialog stays
 * open and highlight a port that appears mid-session, so plugging in a
 * device doesn't require closing and reopening the dialog (#1381).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../_mock-webawesome.js";

vi.mock("@home-assistant/webawesome/dist/components/callout/callout.js", () => ({}));

import type { SerialPort } from "../../src/api/types/system.js";
import { defaultLocalize } from "../../src/common/localize.js";
import { ESPHomeInstallMethodDialog } from "../../src/components/install-method-dialog.js";
import { SERIAL_PORTS_POLL_INTERVAL_MS } from "../../src/util/serial-ports-poll-controller.js";
import { flushTimers } from "../_dom.js";
import { makeSerialPort } from "../_make-serial-port.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function mount(getSerialPorts: () => Promise<SerialPort[]>) {
  const dialog = new ESPHomeInstallMethodDialog();
  (dialog as any)._localize = defaultLocalize;
  (dialog as any)._api = { getSerialPorts };
  dialog.open = true;
  document.body.appendChild(dialog);
  await dialog.updateComplete;
  (dialog as any)._view = "port-select";
  await dialog.updateComplete;
  return dialog;
}

const portRows = (d: ESPHomeInstallMethodDialog) =>
  [...d.shadowRoot!.querySelectorAll(".list .option")] as HTMLElement[];
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("install-method-dialog port polling", () => {
  it("refreshes the open port list and highlights the newly connected port", async () => {
    let ports: SerialPort[] = [makeSerialPort("/dev/ttyUSB0", "CP2102")];
    const getSerialPorts = vi.fn(async () => ports);
    const dialog = await mount(getSerialPorts);

    await flushTimers();
    await dialog.updateComplete;
    expect(portRows(dialog)).toHaveLength(1);

    ports = [...ports, makeSerialPort("/dev/ttyUSB1", "CH340")];
    await vi.advanceTimersByTimeAsync(SERIAL_PORTS_POLL_INTERVAL_MS);
    await dialog.updateComplete;

    const rows = portRows(dialog);
    expect(rows).toHaveLength(2);
    expect(rows[0].classList.contains("is-new")).toBe(false);
    expect(rows[1].classList.contains("is-new")).toBe(true);
    expect(rows[1].querySelector(".new-badge")?.textContent).toBe("New");
  });

  it("badges Espressif native-USB ports and shows the replug hint on multi-port lists", async () => {
    const ports = [
      makeSerialPort("/dev/ttyACM0", "USB JTAG/serial debug unit", {
        vid: 0x303a,
        hint: "esp",
      }),
      makeSerialPort("/dev/ttyUSB0", "CP2102", { vid: 0x10c4, hint: "bridge" }),
    ];
    const dialog = await mount(async () => ports);
    await flushTimers();
    await dialog.updateComplete;

    const rows = portRows(dialog);
    expect(rows[0].querySelector(".esp-badge")?.textContent).toBe("ESP device");
    expect(rows[1].querySelector(".esp-badge")).toBeNull();
    expect(dialog.shadowRoot!.querySelector(".port-hint")).not.toBeNull();
  });

  it("omits the replug hint when a single port leaves no room for doubt", async () => {
    const dialog = await mount(async () => [makeSerialPort("/dev/ttyUSB0", "CP2102")]);
    await flushTimers();
    await dialog.updateComplete;

    expect(dialog.shadowRoot!.querySelector(".port-hint")).toBeNull();
  });

  it("stops polling when the dialog closes", async () => {
    const getSerialPorts = vi.fn(async () => [] as SerialPort[]);
    const dialog = await mount(getSerialPorts);
    await flushTimers();
    expect(getSerialPorts).toHaveBeenCalledTimes(1);

    dialog.open = false;
    await dialog.updateComplete;
    await vi.advanceTimersByTimeAsync(SERIAL_PORTS_POLL_INTERVAL_MS * 3);
    expect(getSerialPorts).toHaveBeenCalledTimes(1);
  });
});
