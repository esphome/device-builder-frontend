/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { onChoiceGroupKeydown } from "../../../src/components/shared/choice-group.js";

const makeGroup = (
  cards: Array<{ id: string; disabled?: boolean; ariaDisabled?: boolean }>
) => {
  const group = document.createElement("div");
  group.setAttribute("role", "radiogroup");
  const clicks: string[] = [];
  for (const card of cards) {
    const btn = document.createElement("button");
    btn.id = card.id;
    btn.setAttribute("role", "radio");
    if (card.disabled) btn.setAttribute("disabled", "");
    if (card.ariaDisabled) btn.setAttribute("aria-disabled", "true");
    btn.addEventListener("click", () => clicks.push(card.id));
    group.appendChild(btn);
  }
  document.body.appendChild(group);
  const fire = (key: string, from: HTMLElement) => {
    const e = new KeyboardEvent("keydown", { key, bubbles: true });
    Object.defineProperty(e, "currentTarget", { value: group });
    Object.defineProperty(e, "target", { value: from });
    onChoiceGroupKeydown(e);
  };
  return { group, clicks, fire };
};

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("onChoiceGroupKeydown", () => {
  it("moves to and selects the next enabled card", () => {
    const { group, clicks, fire } = makeGroup([{ id: "a" }, { id: "b" }]);
    fire("ArrowRight", group.children[0] as HTMLElement);
    expect(clicks).toEqual(["b"]);
  });

  it("focuses an aria-disabled card without selecting it", () => {
    const { group, clicks, fire } = makeGroup([
      { id: "a" },
      { id: "b", ariaDisabled: true },
    ]);
    const focus = vi.spyOn(group.children[1] as HTMLElement, "focus");
    fire("ArrowRight", group.children[0] as HTMLElement);
    expect(focus).toHaveBeenCalled();
    expect(clicks).toEqual([]);
  });

  it("skips a natively disabled card entirely", () => {
    const { group, clicks, fire } = makeGroup([
      { id: "a" },
      { id: "b", disabled: true },
      { id: "c" },
    ]);
    fire("ArrowRight", group.children[0] as HTMLElement);
    expect(clicks).toEqual(["c"]);
  });
});
