/**
 * @vitest-environment happy-dom
 *
 * The cursor-targeted parameter row scrolls in with the shared glow,
 * once per target; an unknown or block-level target flashes the field.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/option/option.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/select/select.js", () => ({}));

import { ESPHomeCallableParamsEditor } from "../../../../src/components/device/automation-editor/callable-params-editor.js";
import { mount } from "../../../_dom.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function spyScroll() {
  return vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
}

describe("callable-params-editor focus", () => {
  it("scrolls the matching row once per target", async () => {
    const scrolled = spyScroll();
    const el = await mount(new ESPHomeCallableParamsEditor(), {
      value: { times: "int", loud: "bool" },
      focusParam: "loud",
    });
    // The wire sync lands in updated(); settle a second pass.
    await el.updateComplete;
    expect(scrolled).toHaveBeenCalledTimes(1);
    const rows = el.shadowRoot!.querySelectorAll(".script-param-row");
    expect(scrolled.mock.instances[0]).toBe(rows[1]);

    // A real re-render with the target unchanged must not re-scroll —
    // the one-shot guard, not Lit's string dedupe, is what holds it.
    el.value = { ...el.value };
    await el.updateComplete;
    await el.updateComplete;
    expect(scrolled).toHaveBeenCalledTimes(1);
  });

  it("falls back to the whole field for a block-level target", async () => {
    const scrolled = spyScroll();
    const el = await mount(new ESPHomeCallableParamsEditor(), {
      value: { times: "int" },
      focusParam: "",
    });
    await el.updateComplete;
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(scrolled.mock.instances[0]).toBe(el.shadowRoot!.querySelector(".field"));
  });

  it("does nothing without a target", async () => {
    const scrolled = spyScroll();
    await mount(new ESPHomeCallableParamsEditor(), { value: { times: "int" } });
    expect(scrolled).not.toHaveBeenCalled();
  });
});
