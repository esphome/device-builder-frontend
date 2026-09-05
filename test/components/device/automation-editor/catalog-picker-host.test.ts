/**
 * @vitest-environment happy-dom
 *
 * One picker per editor tree: nested editors request a pick, the host opens
 * its dialog with the request, and the pick goes back to whoever asked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/components/base-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { identityLocalize } from "../../../_dom.js";
import type { AutomationCondition } from "../../../../src/api/types/automations.js";
import type { ESPHomeCatalogPickerDialog } from "../../../../src/components/device/automation-editor/catalog-picker-dialog.js";
import {
  type CatalogPickRequest,
  ESPHomeCatalogPickerHost,
  requestCatalogPick,
} from "../../../../src/components/device/automation-editor/catalog-picker-host.js";

const condition = (id: string): AutomationCondition =>
  ({ id, name: id, domain: id.split(".")[0], description: "" }) as AutomationCondition;

const actionRequest = (
  onPicked: CatalogPickRequest["onPicked"] = () => {}
): CatalogPickRequest => ({
  kind: "action",
  items: [],
  devices: [],
  onPicked,
});

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
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("opens its one picker with the requesting editor's catalog", async () => {
    const { host, inner, picker } = await mountHost();
    const open = vi.spyOn(picker, "open");
    const request: CatalogPickRequest = {
      kind: "condition",
      items: [condition("sensor.in_range")],
      devices: [],
      onPicked: () => {},
    };
    requestCatalogPick(inner, request);
    expect(open).toHaveBeenCalledWith(request);
    expect(picker.kind).toBe("condition");
    expect(picker.items.map((i) => i.id)).toEqual(["sensor.in_range"]);
    expect(
      host.shadowRoot!.querySelectorAll("esphome-catalog-picker-dialog")
    ).toHaveLength(1);
  });

  it("routes the pick to the latest requester only", async () => {
    const { inner, picker } = await mountHost();
    const first = vi.fn();
    const second = vi.fn();
    requestCatalogPick(inner, actionRequest(first));
    requestCatalogPick(inner, actionRequest(second));
    await picker.updateComplete;
    (picker as unknown as { _pick: (id: string) => void })._pick("switch.toggle");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({
      id: "switch.toggle",
      preFilledParams: undefined,
    });
  });

  it("does not let the request escape above the host", async () => {
    const { inner } = await mountHost();
    const above = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    document.body.addEventListener("request-catalog-pick", above);
    requestCatalogPick(inner, actionRequest());
    expect(above).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    document.body.removeEventListener("request-catalog-pick", above);
  });

  it("warns when no host is above the requester", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const orphan = document.body.appendChild(document.createElement("button"));
    requestCatalogPick(orphan, actionRequest());
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
