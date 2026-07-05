/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";

import type { AvailableComponentInstance } from "../../../../src/api/types/automations.js";
import { ESPHomeComponentTargetPicker } from "../../../../src/components/device/automation-editor/component-target-picker.js";

const aht = (): AvailableComponentInstance[] => [
  { id: "aht20", name: "AHT20", component_id: "sensor.aht10", is_entity_container: true },
  {
    id: "aht20_temperature",
    name: "Temperature",
    component_id: "sensor",
    parent_id: "aht20",
  },
  { id: "aht20_humidity", name: "Humidity", component_id: "sensor", parent_id: "aht20" },
  { id: "relay", name: "Relay", component_id: "switch.gpio" },
];

async function mount(
  devices: AvailableComponentInstance[],
  value = "",
  disabled = false
): Promise<ESPHomeComponentTargetPicker> {
  const el = new ESPHomeComponentTargetPicker();
  el.devices = devices;
  el.value = value;
  el.disabled = disabled;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const choiceIds = (el: ESPHomeComponentTargetPicker): (string | null)[] =>
  [...el.shadowRoot!.querySelectorAll(".component-choice")].map((r) =>
    r.getAttribute("data-id")
  );

const choiceNames = (el: ESPHomeComponentTargetPicker): string[] =>
  [...el.shadowRoot!.querySelectorAll(".component-choice-name")].map((n) =>
    n.textContent!.trim()
  );

const tabStops = (el: ESPHomeComponentTargetPicker): (string | null)[] =>
  [...el.shadowRoot!.querySelectorAll(".component-choice")]
    .filter((r) => r.getAttribute("tabindex") === "0")
    .map((r) => r.getAttribute("data-id"));

function pressOn(
  el: ESPHomeComponentTargetPicker,
  id: string,
  key: string
): string | undefined {
  let picked: string | undefined;
  el.addEventListener("component-change", (e) => {
    picked = (e as CustomEvent<{ componentId: string }>).detail.componentId;
  });
  el.shadowRoot!.querySelector(`.component-choice[data-id="${id}"]`)!.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true })
  );
  return picked;
}

describe("component-target-picker", () => {
  it("lists sub-entities as rows and the container as a group header", async () => {
    const el = await mount(aht());
    expect(choiceNames(el)).toEqual(["Temperature", "Humidity", "Relay"]);
    expect(choiceNames(el)).not.toContain("AHT20");
    const group = el.shadowRoot!.querySelector('[role="group"]')!;
    const headerId = group.getAttribute("aria-labelledby")!;
    expect(el.shadowRoot!.querySelector(`#${headerId}`)!.textContent).toContain("AHT20");
  });

  it("is a radiogroup of radios", async () => {
    const el = await mount(aht());
    expect(el.shadowRoot!.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(choiceIds(el)).toEqual(["aht20_temperature", "aht20_humidity", "relay"]);
    expect(el.shadowRoot!.querySelectorAll('[role="radio"]').length).toBe(3);
  });

  it("keeps a single roving tab stop on the checked row", async () => {
    const el = await mount(aht(), "aht20_humidity");
    expect(tabStops(el)).toEqual(["aht20_humidity"]);
  });

  it("puts the initial tab stop on the first row before any pick", async () => {
    const el = await mount(aht(), "");
    expect(tabStops(el)).toEqual(["aht20_temperature"]);
  });

  it("arrow-down emits the next row and wraps from the last", async () => {
    const el = await mount(aht(), "aht20_temperature");
    expect(pressOn(el, "aht20_temperature", "ArrowDown")).toBe("aht20_humidity");
    const wrap = await mount(aht(), "relay");
    expect(pressOn(wrap, "relay", "ArrowDown")).toBe("aht20_temperature");
  });

  it("Enter and click both select the focused row", async () => {
    const el = await mount(aht(), "");
    expect(pressOn(el, "relay", "Enter")).toBe("relay");
    const el2 = await mount(aht(), "");
    let picked = "";
    el2.addEventListener("component-change", (e) => {
      picked = (e as CustomEvent<{ componentId: string }>).detail.componentId;
    });
    (
      el2.shadowRoot!.querySelector(
        '.component-choice[data-id="aht20_humidity"]'
      ) as HTMLElement
    ).click();
    expect(picked).toBe("aht20_humidity");
  });

  it("emits nothing and dims the rows while disabled", async () => {
    const el = await mount(aht(), "", true);
    expect(pressOn(el, "aht20_temperature", "ArrowDown")).toBeUndefined();
    expect(
      el.shadowRoot!.querySelector('.component-choice[aria-disabled="true"]')
    ).not.toBeNull();
  });

  it("tracks keyboard order to the DOM for interleaved devices", async () => {
    const el = await mount([
      { id: "hub", name: "Hub", component_id: "sensor.aht10", is_entity_container: true },
      { id: "relay", name: "Relay", component_id: "switch.gpio" },
      { id: "hub_temp", name: "Temp", component_id: "sensor", parent_id: "hub" },
    ]);
    expect(choiceIds(el)).toEqual(["hub_temp", "relay"]);
    expect(tabStops(el)).toEqual(["hub_temp"]);
    expect(pressOn(el, "hub_temp", "ArrowDown")).toBe("relay");
  });

  it("keeps a following plain row outside the group wrapper", async () => {
    const el = await mount([
      { id: "api", name: "api", component_id: "api" },
      {
        id: "aht20",
        name: "AHT20",
        component_id: "sensor.aht10",
        is_entity_container: true,
      },
      {
        id: "aht20_temperature",
        name: "Kit Temperature",
        component_id: "sensor",
        parent_id: "aht20",
      },
      { id: "wifi", name: "wifi", component_id: "wifi" },
    ]);
    const sr = el.shadowRoot!;
    const group = sr.querySelector(".component-group-wrap")!;
    // the sub-sensor is inside the group...
    expect(
      group.querySelector('.component-choice[data-id="aht20_temperature"]')
    ).not.toBeNull();
    // ...but the plain wifi row is not (it only looked grouped without the indent).
    expect(
      sr
        .querySelector('.component-choice[data-id="wifi"]')!
        .closest(".component-group-wrap")
    ).toBeNull();
  });

  it("renders an orphan sub-entity whose container is absent", async () => {
    const el = await mount([
      { id: "orphan_t", name: "Orphan Temp", component_id: "sensor", parent_id: "ghost" },
    ]);
    expect(choiceNames(el)).toEqual(["Orphan Temp"]);
  });

  it("shows the empty message when nothing is selectable", async () => {
    const el = await mount([
      {
        id: "aht20",
        name: "AHT20",
        component_id: "sensor.aht10",
        is_entity_container: true,
      },
    ]);
    expect(choiceIds(el)).toEqual([]);
    expect(el.shadowRoot!.querySelector(".error")).not.toBeNull();
  });
});
