/**
 * @vitest-environment happy-dom
 *
 * The "Select a serial port" view must refresh while the dialog stays
 * open and highlight a port that appears mid-session, so plugging in a
 * device doesn't require closing and reopening the dialog (#1381).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));

import type { SerialPort } from "../../src/api/types/system.js";
import { defaultLocalize } from "../../src/common/localize.js";
import { ESPHomeInstallMethodDialog } from "../../src/components/install-method-dialog.js";
import { SERIAL_PORTS_POLL_INTERVAL_MS } from "../../src/util/serial-ports-poll-controller.js";

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
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("install-method-dialog port polling", () => {
  it("refreshes the open port list and highlights the newly connected port", async () => {
    let ports: SerialPort[] = [{ port: "/dev/ttyUSB0", desc: "CP2102" }];
    const getSerialPorts = vi.fn(async () => ports);
    const dialog = await mount(getSerialPorts);

    await vi.advanceTimersByTimeAsync(0);
    await dialog.updateComplete;
    expect(portRows(dialog)).toHaveLength(1);

    ports = [...ports, { port: "/dev/ttyUSB1", desc: "CH340" }];
    await vi.advanceTimersByTimeAsync(SERIAL_PORTS_POLL_INTERVAL_MS);
    await dialog.updateComplete;

    const rows = portRows(dialog);
    expect(rows).toHaveLength(2);
    expect(rows[0].classList.contains("is-new")).toBe(false);
    expect(rows[1].classList.contains("is-new")).toBe(true);
    expect(rows[1].querySelector(".new-badge")?.textContent).toBe("New");
  });

  it("stops polling when the dialog closes", async () => {
    const getSerialPorts = vi.fn(async () => [] as SerialPort[]);
    const dialog = await mount(getSerialPorts);
    await vi.advanceTimersByTimeAsync(0);
    expect(getSerialPorts).toHaveBeenCalledTimes(1);

    dialog.open = false;
    await dialog.updateComplete;
    await vi.advanceTimersByTimeAsync(SERIAL_PORTS_POLL_INTERVAL_MS * 3);
    expect(getSerialPorts).toHaveBeenCalledTimes(1);
  });
});
