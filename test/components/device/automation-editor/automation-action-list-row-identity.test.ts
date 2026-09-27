/**
 * @vitest-environment happy-dom
 *
 * A row's element, and what it remembers, follows its action through a
 * delete or a reorder (esphome/device-builder-frontend#1882). The real list, node
 * and form are mounted, since per-row state lives across all three: the
 * node's view flags, the form's pending unit and the literal / lambda
 * stash.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock(
  "../../../../src/components/device/automation-editor/automation-condition-tree.js",
  () => ({})
);
vi.mock(
  "../../../../src/components/device/automation-editor/catalog-picker-host.js",
  () => ({ requestCatalogPick: () => {} })
);
vi.mock(
  "../../../../src/components/device/config-entry-renderers/lambda-editor.js",
  () => ({})
);
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/option/option.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/select/select.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/switch/switch.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/tooltip/tooltip.js", () => ({}));

import { makeAutomationAction } from "../../../_make-automation-action.js";
import type { ActionNode } from "../../../../src/api/types/automations.js";
import { ESPHomeAutomationActionList } from "../../../../src/components/device/automation-editor/automation-action-list.js";
import type { ESPHomeAutomationActionNode } from "../../../../src/components/device/automation-editor/automation-action-node.js";
import type { ESPHomeConfigEntryForm } from "../../../../src/components/device/config-entry-form.js";

const DELAY = makeAutomationAction({
  id: "delay",
  name: "Delay",
  value_type: "time_period",
  templatable: true,
  duration_min_unit: "ms",
});

const delay = (id?: unknown): ActionNode => ({
  action_id: "delay",
  params: id === undefined ? {} : { id },
});
const lambda = (body: string) => ({ _lambda: body, _tag: "!lambda" });

async function settle(list: ESPHomeAutomationActionList): Promise<void> {
  await list.updateComplete;
  for (const node of nodes(list)) {
    await node.updateComplete;
    await form(node)?.updateComplete;
  }
}

async function mountList(actions: ActionNode[]) {
  const list = new ESPHomeAutomationActionList();
  list.actions = actions;
  list.catalog = [DELAY];
  // The list is controlled: the owner hands each change back.
  list.addEventListener("actions-change", (e) => {
    list.actions = (e as CustomEvent<{ actions: ActionNode[] }>).detail.actions;
  });
  document.body.appendChild(list);
  await settle(list);
  return list;
}

function nodes(list: ESPHomeAutomationActionList): ESPHomeAutomationActionNode[] {
  return [...list.shadowRoot!.querySelectorAll("esphome-automation-action-node")];
}

function form(node: ESPHomeAutomationActionNode): ESPHomeConfigEntryForm | null {
  return node.shadowRoot!.querySelector("esphome-config-entry-form");
}

function nodeButton(node: ESPHomeAutomationActionNode, selector: string) {
  return node.shadowRoot!.querySelector<HTMLButtonElement>(selector)!;
}

function toggle(node: ESPHomeAutomationActionNode, side: "literal" | "lambda"): void {
  form(node)!
    .shadowRoot!.querySelectorAll<HTMLButtonElement>(".templatable-toggle button")
    [side === "literal" ? 0 : 1].click();
}

function typeDuration(node: ESPHomeAutomationActionNode, amount: string): void {
  const input = form(node)!.shadowRoot!.querySelector<HTMLInputElement>(
    ".time-period-inputs input"
  )!;
  input.value = amount;
  input.dispatchEvent(new Event("input"));
}

const MOVE_DOWN = 'button[aria-label="device.automation_move_down"]';

describe("automation-action-list row identity", () => {
  it("does not restore a deleted action's lambda into the one that remains", async () => {
    const list = await mountList([delay(lambda("return 1111;")), delay("2s")]);

    toggle(nodes(list)[0], "literal");
    await settle(list);
    nodeButton(nodes(list)[0], ".ae-row-delete").click();
    await settle(list);
    expect(list.actions).toEqual([delay("2s")]);

    toggle(nodes(list)[0], "lambda");
    await settle(list);

    expect(list.actions).toEqual([delay(lambda(""))]);
  });

  it("keeps a row's stashed lambda when the row above it is deleted", async () => {
    const list = await mountList([delay("1s"), delay(lambda("return 2222;"))]);

    toggle(nodes(list)[1], "literal");
    await settle(list);
    nodeButton(nodes(list)[0], ".ae-row-delete").click();
    await settle(list);
    toggle(nodes(list)[0], "lambda");
    await settle(list);

    expect(list.actions).toEqual([delay(lambda("return 2222;"))]);
  });

  it("moves a row's element with its action on a reorder", async () => {
    const list = await mountList([delay("1s"), delay("2s")]);
    const [first, second] = nodes(list);

    nodeButton(first, MOVE_DOWN).click();
    await settle(list);

    expect(list.actions).toEqual([delay("2s"), delay("1s")]);
    expect(nodes(list)).toEqual([second, first]);
    expect(first.value).toEqual(delay("1s"));
  });

  it("puts focus back on the move button once its row has moved", async () => {
    const list = await mountList([delay("1s"), delay("2s"), delay("3s")]);
    const button = nodeButton(nodes(list)[0], MOVE_DOWN);
    button.focus();
    const focus = vi.spyOn(button, "focus");

    button.click();
    await settle(list);

    expect(nodes(list)[1].shadowRoot!.activeElement).toBe(button);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("leaves focus alone when the owner drops the move", async () => {
    const list = new ESPHomeAutomationActionList();
    list.actions = [delay("1s"), delay("2s"), delay("3s")];
    list.catalog = [DELAY];
    document.body.appendChild(list);
    await settle(list);
    const button = nodeButton(nodes(list)[0], MOVE_DOWN);
    const focus = vi.spyOn(button, "focus");

    button.click();
    list.disabled = true;
    await settle(list);

    expect(focus).not.toHaveBeenCalled();
  });

  it("acts on the moved row, not on the one that took its place", async () => {
    const list = await mountList([delay("1s"), delay("2s"), delay("3s")]);
    const [first] = nodes(list);

    nodeButton(first, MOVE_DOWN).click();
    await settle(list);
    nodeButton(first, ".ae-row-delete").click();
    await settle(list);

    expect(list.actions).toEqual([delay("2s"), delay("3s")]);
  });

  it("does not hand the caret's target to a row moved onto its index", async () => {
    const list = await mountList([delay("1s"), delay("2s"), delay("3s")]);
    list.focusTarget = { node: [1], field: [] };
    await settle(list);
    const [first, second] = nodes(list);
    expect(second.focusTarget).toEqual({ node: [], field: [] });

    nodeButton(first, "button[aria-expanded]").click();
    await settle(list);
    nodeButton(first, MOVE_DOWN).click();
    await settle(list);

    expect(nodes(list)[1]).toBe(first);
    expect(first.focusTarget).toBeNull();
    expect(nodeButton(first, "button[aria-expanded]").getAttribute("aria-expanded")).toBe(
      "false"
    );
  });

  it("keeps a collapsed card collapsed when it is moved", async () => {
    const list = await mountList([delay("1s"), delay("2s")]);

    nodeButton(nodes(list)[0], "button[aria-expanded]").click();
    await settle(list);
    nodeButton(nodes(list)[0], MOVE_DOWN).click();
    await settle(list);

    const expanded = nodes(list).map((node) =>
      nodeButton(node, "button[aria-expanded]").getAttribute("aria-expanded")
    );
    expect(expanded).toEqual(["true", "false"]);
  });

  it("keeps a unit picked on an empty delay with its row", async () => {
    const list = await mountList([delay(), delay("2s")]);
    const empty = nodes(list)[0];

    const select = form(empty)!.shadowRoot!.querySelector(
      ".time-period-inputs wa-select"
    ) as HTMLElement & { value: string };
    select.value = "min";
    select.dispatchEvent(new Event("change"));
    await settle(list);
    nodeButton(empty, MOVE_DOWN).click();
    await settle(list);

    typeDuration(nodes(list)[1], "5");
    await settle(list);

    expect(list.actions).toEqual([delay("2s"), delay("5min")]);
  });

  it("keeps a row's element when a field in it is edited", async () => {
    const list = await mountList([delay("1s"), delay("2s")]);
    const before = nodes(list);

    typeDuration(before[1], "9");
    await settle(list);

    expect(list.actions).toEqual([delay("1s"), delay("9s")]);
    expect(nodes(list)).toEqual(before);
  });

  describe("a list read again from the YAML, every action a new object", () => {
    const collapsed = (list: ESPHomeAutomationActionList) =>
      nodes(list).map(
        (node) =>
          nodeButton(node, "button[aria-expanded]").getAttribute("aria-expanded") ===
          "false"
      );

    async function reread(list: ESPHomeAutomationActionList, actions: ActionNode[]) {
      list.actions = actions;
      await settle(list);
    }

    it("keeps a collapsed card collapsed when an action is added above it", async () => {
      const list = await mountList([delay("1s"), delay("2s")]);
      const second = nodes(list)[1];
      nodeButton(second, "button[aria-expanded]").click();
      await settle(list);

      await reread(list, [delay("5s"), delay("1s"), delay("2s")]);

      expect(collapsed(list)).toEqual([false, false, true]);
      expect(nodes(list)[2]).toBe(second);
    });

    it("keeps a collapsed card collapsed when the action above it is removed", async () => {
      const list = await mountList([delay("1s"), delay("2s")]);
      nodeButton(nodes(list)[1], "button[aria-expanded]").click();
      await settle(list);

      await reread(list, [delay("2s")]);

      expect(collapsed(list)).toEqual([true]);
    });

    it("does not restore a removed action's lambda into the one that remains", async () => {
      const list = await mountList([delay(lambda("return 1111;")), delay("2s")]);
      toggle(nodes(list)[0], "literal");
      await settle(list);

      await reread(list, [delay("2s")]);
      toggle(nodes(list)[0], "lambda");
      await settle(list);

      expect(list.actions).toEqual([delay(lambda(""))]);
    });
  });
});
