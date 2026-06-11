/**
 * @vitest-environment happy-dom
 *
 * The method step's promised drag-and-drop (the "you can also drag and
 * drop" hint) must import the dropped file through the same
 * ``import-file`` event as the file-input path (#1386).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { defaultLocalize } from "../../../src/common/localize.js";
import { ESPHomeWizardStepMethod } from "../../../src/components/wizard/wizard-step-method.js";
import { dragEvent } from "../../_drag-event.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function mount(): Promise<ESPHomeWizardStepMethod> {
  const el = new ESPHomeWizardStepMethod();
  (el as any)._localize = defaultLocalize;
  document.body.appendChild(el);
  el.checkVisibility = () => true;
  await el.updateComplete;
  return el;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

afterEach(() => {
  document.body.innerHTML = "";
});

describe("wizard-step-method drag and drop", () => {
  it("highlights the step while a file drag hovers", async () => {
    const el = await mount();
    el.dispatchEvent(dragEvent("dragover"));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".drop-zone--active")).not.toBeNull();

    el.dispatchEvent(dragEvent("dragleave"));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".drop-zone--active")).toBeNull();
  });

  it("fires import-file with the dropped YAML, like the file-input path", async () => {
    const el = await mount();
    const seen: File[] = [];
    el.addEventListener("import-file", (e) =>
      seen.push((e as CustomEvent<{ file: File }>).detail.file)
    );
    const yaml = new File(["esphome:"], "kitchen.yaml");
    const drop = dragEvent("drop", { files: [yaml] });
    el.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(seen).toEqual([yaml]);
  });
});
