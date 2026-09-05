/**
 * @vitest-environment happy-dom
 *
 * One picker per editor tree: nested editors request a pick, the host opens
 * its dialog with the request's catalog, and the pick goes back to whoever
 * asked.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/components/base-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { identityLocalize } from "../../../_dom.js";
import type { AutomationAction } from "../../../../src/api/types/automations.js";
import type { ESPHomeCatalogPickerDialog } from "../../../../src/components/device/automation-editor/catalog-picker-dialog.js";
import {
  ESPHomeCatalogPickerHost,
  requestCatalogPick,
} from "../../../../src/components/device/automation-editor/catalog-picker-host.js";

const action = (id: string): AutomationAction =>
  ({ id, name: id, domain: id.split(".")[0], description: "" }) as AutomationAction;

async function mountHost() {
  const host = new ESPHomeCatalogPickerHost();
  // A child with its own shadow root, like an action node under the list.
  const child = document.createElement("div");
  const inner = child
    .attachShadow({ mode: "open" })
    .appendChild(document.createElement("button"));
  host.append(child);
  document.body.appendChild(host);
  await host.updateComplete;
  const picker = host.shadowRoot!.querySelector<ESPHomeCatalogPickerDialog>(
    "esphome-catalog-picker-dialog"
  )!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (picker as any)._localize = identityLocalize;
  return { host, inner, picker };
}

describe("esphome-catalog-picker-host", () => {
  it("opens its one picker with the requesting editor's catalog", async () => {
    const { host, inner, picker } = await mountHost();
    const open = vi.spyOn(picker, "open");
    requestCatalogPick(inner, {
      kind: "condition",
      items: [action("sensor.in_range")],
      devices: [],
      onPicked: () => {},
    });
    await host.updateComplete;
    await host.updateComplete;
    expect(open).toHaveBeenCalledTimes(1);
    expect(picker.kind).toBe("condition");
    expect(picker.items.map((i) => i.id)).toEqual(["sensor.in_range"]);
    expect(
      host.shadowRoot!.querySelectorAll("esphome-catalog-picker-dialog")
    ).toHaveLength(1);
  });

  it("routes the pick to the latest requester only", async () => {
    const { host, inner, picker } = await mountHost();
    vi.spyOn(picker, "open");
    const first = vi.fn();
    const second = vi.fn();
    requestCatalogPick(inner, {
      kind: "action",
      items: [],
      devices: [],
      onPicked: first,
    });
    await host.updateComplete;
    requestCatalogPick(inner, {
      kind: "action",
      items: [],
      devices: [],
      onPicked: second,
    });
    await host.updateComplete;
    picker.dispatchEvent(
      new CustomEvent("catalog-picked", {
        detail: { id: "switch.toggle" },
        bubbles: true,
      })
    );
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ id: "switch.toggle" });
  });

  it("does not let the request escape above the host", async () => {
    const { host, inner } = await mountHost();
    const above = vi.fn();
    document.body.addEventListener("request-catalog-pick", above);
    requestCatalogPick(inner, {
      kind: "action",
      items: [],
      devices: [],
      onPicked: () => {},
    });
    expect(above).not.toHaveBeenCalled();
    document.body.removeEventListener("request-catalog-pick", above);
    host.remove();
  });
});
