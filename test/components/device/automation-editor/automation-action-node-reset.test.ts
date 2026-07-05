/**
 * @vitest-environment happy-dom
 *
 * Behavioral mount tests for ``automation-action-node.ts``.
 *
 * The action list renders rows with a plain ``actions.map(...)`` (no
 * keyed ``repeat()``), so Lit reuses each ``<esphome-automation-action-node>``
 * element by DOM position. Reordering / deleting only rebinds the
 * element's ``.value``; the per-row ``@state`` (``_collapsed`` /
 * ``_showAdvanced``) must NOT leak from the previous action onto the
 * one that lands at that slot. These tests pin that contract through
 * the observable DOM (``aria-expanded``, the body block, the
 * ``show-advanced`` attribute on the params form).
 *
 * The node drags CodeMirror in transitively through
 * ``config-entry-form`` → ``lambda-editor`` and its picker / condition
 * children, so ``vi.mock`` no-ops those modules; the node itself
 * constructs in a happy-dom window.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/components/device/config-entry-form.js", () => ({}));
vi.mock(
  "../../../../src/components/device/automation-editor/automation-condition-tree.js",
  () => ({})
);
vi.mock(
  "../../../../src/components/device/automation-editor/catalog-picker-dialog.js",
  () => ({})
);
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/option/option.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/select/select.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/switch/switch.js", () => ({}));

import type {
  ActionNode,
  AutomationAction,
} from "../../../../src/api/types/automations.js";
import type { ConfigEntry } from "../../../../src/api/types/config-entries.js";
import { ESPHomeAutomationActionNode } from "../../../../src/components/device/automation-editor/automation-action-node.js";

/** Minimal ConfigEntry; only ``key`` and ``advanced`` are read by the
 *  node's advanced-toggle gate. */
function entry(key: string, advanced: boolean): ConfigEntry {
  return {
    key,
    advanced,
    type: "string",
    label: key,
    required: false,
  } as unknown as ConfigEntry;
}

/** Catalog action with a mixed advanced/non-advanced entry set so the
 *  "Show advanced" toggle renders and ``show-advanced`` tracks the
 *  user's ``_showAdvanced`` choice. */
function action(id: string): AutomationAction {
  return {
    id,
    name: id,
    description: "",
    config_entries: [entry("plain", false), entry("secret", true)],
    accepts_action_list: [],
  } as unknown as AutomationAction;
}

function node(action_id: string): ActionNode {
  return { action_id, params: {} };
}

const CATALOG = [action("set_variable"), action("logger.log")];

async function mountNode(value: ActionNode): Promise<ESPHomeAutomationActionNode> {
  const el = new ESPHomeAutomationActionNode();
  el.value = value;
  el.catalog = CATALOG;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

/** The collapse/expand control is the only button carrying
 *  ``aria-expanded``. */
function collapseButton(el: ESPHomeAutomationActionNode): HTMLButtonElement {
  return el.shadowRoot!.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
}

function bodyPresent(el: ESPHomeAutomationActionNode): boolean {
  return el.shadowRoot!.querySelector(".ae-row-body") !== null;
}

function paramsForm(el: ESPHomeAutomationActionNode): Element {
  return el.shadowRoot!.querySelector("esphome-config-entry-form")!;
}

/** Drive advanced on via the form's advanced-toggle event (the contract the
 *  host wires to its _showAdvanced state). */
function enableAdvanced(el: ESPHomeAutomationActionNode): void {
  paramsForm(el).dispatchEvent(
    new CustomEvent("advanced-toggle", {
      detail: { show: true },
      bubbles: true,
      composed: true,
    })
  );
}

describe("automation-action-node view-state reset on rebind", () => {
  it("defaults to expanded", async () => {
    const el = await mountNode(node("set_variable"));
    expect(collapseButton(el).getAttribute("aria-expanded")).toBe("true");
    expect(bodyPresent(el)).toBe(true);
  });

  it("resets collapsed state when rebound to a different action_id", async () => {
    const el = await mountNode(node("set_variable"));

    // User collapses the row.
    collapseButton(el).click();
    await el.updateComplete;
    expect(collapseButton(el).getAttribute("aria-expanded")).toBe("false");
    expect(bodyPresent(el)).toBe(false);

    // Reorder rebinds this slot to a different action (simulated by the
    // list swapping the .value the reused element points at).
    el.value = node("logger.log");
    await el.updateComplete;

    expect(collapseButton(el).getAttribute("aria-expanded")).toBe("true");
    expect(bodyPresent(el)).toBe(true);
  });

  it("preserves collapsed state across same-action param edits", async () => {
    const el = await mountNode(node("set_variable"));

    collapseButton(el).click();
    await el.updateComplete;
    expect(collapseButton(el).getAttribute("aria-expanded")).toBe("false");

    // A param edit re-emits a fresh ActionNode object with the SAME
    // action_id every keystroke. The row must stay collapsed.
    el.value = { action_id: "set_variable", params: { value: "1" } };
    await el.updateComplete;

    expect(collapseButton(el).getAttribute("aria-expanded")).toBe("false");
    expect(bodyPresent(el)).toBe(false);
  });

  it("resets the advanced toggle when rebound to a different action_id", async () => {
    const el = await mountNode(node("set_variable"));
    expect(paramsForm(el).hasAttribute("show-advanced")).toBe(false);

    enableAdvanced(el);
    await el.updateComplete;
    expect(paramsForm(el).hasAttribute("show-advanced")).toBe(true);

    // Rebind to a different action — advanced must fall back to off.
    el.value = node("logger.log");
    await el.updateComplete;
    expect(paramsForm(el).hasAttribute("show-advanced")).toBe(false);
  });

  it("preserves the advanced toggle across same-action param edits", async () => {
    const el = await mountNode(node("set_variable"));

    enableAdvanced(el);
    await el.updateComplete;
    expect(paramsForm(el).hasAttribute("show-advanced")).toBe(true);

    el.value = { action_id: "set_variable", params: { value: "1" } };
    await el.updateComplete;
    expect(paramsForm(el).hasAttribute("show-advanced")).toBe(true);
  });
});
