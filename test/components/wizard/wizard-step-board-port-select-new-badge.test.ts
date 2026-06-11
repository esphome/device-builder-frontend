/**
 * @vitest-environment happy-dom
 *
 * Ports flagged in ``newPorts`` render highlighted with a "New" badge
 * so a just-plugged-in device is findable mid-wizard (#1381).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));

import { defaultLocalize } from "../../../src/common/localize.js";
import { ESPHomeWizardStepBoardPortSelect } from "../../../src/components/wizard/wizard-step-board-port-select.js";

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

afterEach(() => {
  document.body.innerHTML = "";
});

describe("wizard-step-board-port-select new-port badge", () => {
  it("highlights only the ports flagged as new", async () => {
    const el = await mount({
      ports: [
        { port: "/dev/ttyUSB0", desc: "CP2102" },
        { port: "/dev/ttyUSB1", desc: "CH340" },
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
});
