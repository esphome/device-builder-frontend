/**
 * @vitest-environment happy-dom
 *
 * Ports flagged in ``newPorts`` render highlighted with a "New" badge
 * so a just-plugged-in device is findable mid-wizard (#1381).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));

import { defaultLocalize } from "../../../src/common/localize.js";
import { ESPHomeWizardStepBoardPortSelect } from "../../../src/components/wizard/wizard-step-board-port-select.js";
import { makeSerialPort } from "../../_make-serial-port.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function mount(
  props: Partial<ESPHomeWizardStepBoardPortSelect>
): Promise<ESPHomeWizardStepBoardPortSelect> {
  const el = new ESPHomeWizardStepBoardPortSelect();
  (el as any)._localize = defaultLocalize;
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("wizard-step-board-port-select new-port badge", () => {
  it("highlights only the ports flagged as new", async () => {
    const el = await mount({
      ports: [
        makeSerialPort("/dev/ttyUSB0", "CP2102"),
        makeSerialPort("/dev/ttyUSB1", "CH340"),
      ],
      newPorts: new Set(["/dev/ttyUSB1"]),
    });
    const rows = [...el.shadowRoot!.querySelectorAll(".option")];
    expect(rows).toHaveLength(2);
    expect(rows[0].classList.contains("is-new")).toBe(false);
    expect(rows[0].querySelector(".new-badge")).toBeNull();
    expect(rows[1].classList.contains("is-new")).toBe(true);
    expect(rows[1].querySelector(".new-badge")?.textContent).toBe("New");
  });

  it("badges Espressif native-USB ports and shows the replug hint on multi-port lists", async () => {
    const el = await mount({
      ports: [
        makeSerialPort("/dev/ttyACM0", "USB JTAG/serial debug unit", {
          vid: 0x303a,
          hint: "esp",
        }),
        makeSerialPort("/dev/ttyUSB0", "CP2102", { vid: 0x10c4, hint: "bridge" }),
      ],
      newPorts: new Set(),
    });
    const rows = [...el.shadowRoot!.querySelectorAll(".option")];
    expect(rows[0].querySelector(".esp-badge")?.textContent).toBe("ESP device");
    expect(rows[1].querySelector(".esp-badge")).toBeNull();
    expect(el.shadowRoot!.querySelector(".port-hint")).not.toBeNull();
  });

  it("omits the replug hint when a single port leaves no room for doubt", async () => {
    const el = await mount({
      ports: [makeSerialPort("/dev/ttyUSB0", "CP2102")],
      newPorts: new Set(),
    });
    expect(el.shadowRoot!.querySelector(".port-hint")).toBeNull();
  });
});
