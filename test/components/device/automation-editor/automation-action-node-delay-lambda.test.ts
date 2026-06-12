/**
 * @vitest-environment happy-dom
 *
 * The Delay action is templatable: ``delay: !lambda "..."`` arrives as a
 * lambda sentinel under ``params.id``. The bespoke delay renderer must
 * surface it in the C++ editor (not coerce it to "0 Seconds") and round-trip
 * the ``!lambda`` tag, while still rendering a plain ``delay: 2s`` as the
 * value + unit widget. Pins #1335.
 *
 * The node imports ``lambda-editor`` (CodeMirror) directly; ``vi.mock``
 * no-ops it and the other heavy children so the node constructs in happy-dom.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/components/device/config-entry-form.js", () => ({}));
vi.mock(
  "../../../../src/components/device/config-entry-renderers/lambda-editor.js",
  () => ({})
);
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

import type {
  ActionNode,
  AutomationAction,
} from "../../../../src/api/types/automations.js";
import { ESPHomeAutomationActionNode } from "../../../../src/components/device/automation-editor/automation-action-node.js";

const DELAY_FIELDS = [
  "days",
  "hours",
  "microseconds",
  "milliseconds",
  "minutes",
  "seconds",
] as const;

const DELAY_ACTION: AutomationAction = {
  id: "delay",
  name: "Delay",
  description: "",
  config_entries: DELAY_FIELDS.map((key) => ({
    key,
    advanced: true,
    type: "string",
    label: key,
    required: false,
  })),
  accepts_action_list: [],
} as unknown as AutomationAction;

async function mountDelay(
  params: Record<string, unknown>
): Promise<{ el: ESPHomeAutomationActionNode; emitted: ActionNode[] }> {
  const el = new ESPHomeAutomationActionNode();
  el.value = { action_id: "delay", params };
  el.catalog = [DELAY_ACTION];
  // The node is presentational: it emits a fresh ActionNode and the parent
  // owns ``value``. Mirror that here so toggles see the updated state.
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

function lambdaEditor(el: ESPHomeAutomationActionNode): HTMLElement | null {
  return el.shadowRoot!.querySelector<HTMLElement>("esphome-lambda-editor");
}

function valueInput(el: ESPHomeAutomationActionNode): HTMLInputElement | null {
  return el.shadowRoot!.querySelector<HTMLInputElement>("#ae-delay-value-input");
}

/** The unit on the wa-select's own ``value`` attribute — the control's
 *  canonical selection source — cross-checked against the option the
 *  renderer marked ``selected``. */
function selectedUnit(el: ESPHomeAutomationActionNode): string | null {
  const select = el.shadowRoot!.querySelector("#ae-delay-unit-select");
  const value = select?.getAttribute("value") ?? null;
  const marked =
    select?.querySelector("wa-option[selected]")?.getAttribute("value") ?? null;
  return value === marked ? value : `value=${value} selected=${marked}`;
}

function toggleButtons(el: ESPHomeAutomationActionNode): HTMLButtonElement[] {
  return [
    ...el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".templatable-toggle button"),
  ];
}

describe("automation-action-node delay lambda", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the lambda body in the editor, not a 0/Seconds default", async () => {
    const { el } = await mountDelay({
      id: { _lambda: "return 0;", _tag: "!lambda" },
    });

    const editor = lambdaEditor(el);
    expect(editor).not.toBeNull();
    expect((editor as unknown as { value: string }).value).toBe("return 0;");
    // Literal value + unit widget is hidden while in lambda mode.
    expect(valueInput(el)).toBeNull();
    // The lambda tab is the active one.
    const [, lambdaBtn] = toggleButtons(el);
    expect(lambdaBtn.classList.contains("active")).toBe(true);
  });

  it("preserves the !lambda tag when the body is edited", async () => {
    const { el, emitted } = await mountDelay({
      id: { _lambda: "return 0;", _tag: "!lambda" },
    });

    lambdaEditor(el)!.dispatchEvent(
      new CustomEvent("lambda-change", { detail: { value: "return 1;" } })
    );

    expect(emitted[emitted.length - 1].params).toEqual({
      id: { _lambda: "return 1;", _tag: "!lambda" },
    });
  });

  it("keeps the lambda body when toggling to literal and back", async () => {
    const { el } = await mountDelay({
      id: { _lambda: "return 7;", _tag: "!lambda" },
    });
    const [literalBtn, lambdaBtn] = toggleButtons(el);

    literalBtn.click();
    await el.updateComplete;
    // Now in literal mode: editor gone, blank value/unit widget shown.
    expect(lambdaEditor(el)).toBeNull();
    expect(valueInput(el)!.value).toBe("");

    lambdaBtn.click();
    await el.updateComplete;
    expect((lambdaEditor(el) as unknown as { value: string }).value).toBe("return 7;");
  });

  it("keeps the value + unit when toggling to lambda and back", async () => {
    const { el } = await mountDelay({ seconds: "5" });
    const [literalBtn, lambdaBtn] = toggleButtons(el);

    lambdaBtn.click();
    await el.updateComplete;
    expect(lambdaEditor(el)).not.toBeNull();

    literalBtn.click();
    await el.updateComplete;
    expect(valueInput(el)!.value).toBe("5");
    expect(selectedUnit(el)).toBe("s");
  });

  it("still renders a plain string shorthand as value + unit", async () => {
    const { el } = await mountDelay({ id: "2s" });
    expect(lambdaEditor(el)).toBeNull();
    expect(valueInput(el)!.value).toBe("2");
    expect(selectedUnit(el)).toBe("s");
  });

  it("still renders a canonical unit field as value + unit", async () => {
    const { el } = await mountDelay({ seconds: "5" });
    expect(valueInput(el)!.value).toBe("5");
    expect(selectedUnit(el)).toBe("s");
  });
});
