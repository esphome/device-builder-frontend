/**
 * @vitest-environment happy-dom
 *
 * A scalar-bodied action (``delay: 2s``) has one value and no catalog
 * fields. The node renders that value through the regular params form, as a
 * single entry under the backend's ``id`` slot, so it gets the same
 * value + unit widget and literal / lambda toggle as any other field.
 *
 * ``vi.mock`` no-ops the form and the other heavy children so the node
 * constructs in happy-dom; the widget itself is covered by
 * ``render-time-period-duration.test.ts``.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/components/device/config-entry-form.js", () => ({}));
vi.mock(
  "../../../../src/components/device/automation-editor/automation-condition-tree.js",
  () => ({})
);
vi.mock(
  "../../../../src/components/device/automation-editor/catalog-picker-host.js",
  () => ({
    requestCatalogPick: () => {},
  })
);
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/option/option.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/select/select.js", () => ({}));

import { makeAutomationAction } from "../../../_make-automation-action.js";
import type { ActionNode } from "../../../../src/api/types/automations.js";
import {
  type ConfigEntry,
  ConfigEntryType,
} from "../../../../src/api/types/config-entries.js";
import { ESPHomeAutomationActionNode } from "../../../../src/components/device/automation-editor/automation-action-node.js";

const DELAY_ACTION = makeAutomationAction({
  id: "delay",
  name: "Delay",
  value_type: "time_period",
  templatable: true,
  duration_min_unit: "ms",
});

const LAMBDA = { _lambda: "return 0;", _tag: "!lambda" };

interface FormStub extends HTMLElement {
  entries: ConfigEntry[];
  values: Record<string, unknown>;
}

async function mountDelay(
  params: Record<string, unknown>
): Promise<{ el: ESPHomeAutomationActionNode; emitted: ActionNode[] }> {
  const el = new ESPHomeAutomationActionNode();
  el.value = { action_id: "delay", params };
  el.catalog = [DELAY_ACTION];
  // The node is presentational: it emits a fresh ActionNode and the parent
  // owns ``value``. Mirror that here so later edits see the updated state.
  const emitted: ActionNode[] = [];
  el.addEventListener("action-change", (e) => {
    const next = (e as CustomEvent<{ value: ActionNode }>).detail.value;
    emitted.push(next);
    el.value = next;
  });
  document.body.appendChild(el);
  await el.updateComplete;
  return { el, emitted };
}

function form(el: ESPHomeAutomationActionNode): FormStub | null {
  return el.shadowRoot!.querySelector<FormStub>("esphome-config-entry-form");
}

async function change(
  el: ESPHomeAutomationActionNode,
  path: string[],
  value: unknown
): Promise<void> {
  form(el)!.dispatchEvent(
    new CustomEvent("value-change", {
      detail: { path, value },
      bubbles: true,
      composed: true,
    })
  );
  await el.updateComplete;
}

describe("automation-action-node scalar-bodied action", () => {
  it("renders the value as one templatable duration field", async () => {
    const { el } = await mountDelay({ id: "2s" });
    expect(form(el)!.entries).toEqual([
      expect.objectContaining({
        key: "id",
        type: ConfigEntryType.TIME_PERIOD,
        label: "device.automation_action_delay_value",
        required: true,
        templatable: true,
        duration_min_unit: "ms",
        accepts_duration_mapping: true,
      }),
    ]);
  });

  it.each([
    ["a scalar", { id: "2s" }],
    ["an aliased scalar", { id: "1sec" }],
    ["a lambda", { id: LAMBDA }],
    ["a unit mapping", { id: { seconds: 2 } }],
    ["a multi-unit mapping", { id: { minutes: 1, seconds: 30 } }],
  ])("hands %s to the form untouched", async (_label, params) => {
    const { el, emitted } = await mountDelay(params);
    expect(form(el)!.values).toBe(params);
    expect(emitted).toEqual([]);
  });

  it("renders the form for a new delay with no value yet", async () => {
    const { el } = await mountDelay({});
    expect(form(el)!.entries).toHaveLength(1);
  });

  it("keeps the same entries across an edit", async () => {
    const { el } = await mountDelay({ id: "2s" });
    const before = form(el)!.entries;
    await change(el, ["id"], "5s");
    expect(form(el)!.entries).toBe(before);
  });

  it("writes an edited value into the value slot", async () => {
    const { el, emitted } = await mountDelay({ id: "1sec" });
    await change(el, ["id"], "2s");
    expect(emitted[emitted.length - 1].params).toEqual({ id: "2s" });
  });

  it("replaces a unit mapping with the scalar the widget wrote", async () => {
    const { el, emitted } = await mountDelay({ id: { seconds: 2 } });
    await change(el, ["id"], "5s");
    expect(emitted[emitted.length - 1].params).toEqual({ id: "5s" });
  });

  it("preserves the !lambda tag the lambda field writes", async () => {
    const { el, emitted } = await mountDelay({ id: LAMBDA });
    await change(el, ["id"], { _lambda: "return 1;", _tag: "!lambda" });
    expect(emitted[emitted.length - 1].params).toEqual({
      id: { _lambda: "return 1;", _tag: "!lambda" },
    });
  });

  it("drops the value slot when the field is cleared", async () => {
    const { el, emitted } = await mountDelay({ id: "2s" });
    await change(el, ["id"], "");
    expect(emitted[emitted.length - 1].params).toEqual({});
  });

  it("renders no form for an action with neither fields nor a value", async () => {
    const el = new ESPHomeAutomationActionNode();
    el.value = { action_id: "ethernet.disable", params: {} };
    el.catalog = [makeAutomationAction({ id: "ethernet.disable" })];
    document.body.appendChild(el);
    await el.updateComplete;
    expect(form(el)).toBeNull();
  });
});
