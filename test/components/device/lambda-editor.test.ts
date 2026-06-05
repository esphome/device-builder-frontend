/**
 * @vitest-environment happy-dom
 *
 * Regression test for #1223: the inline lambda editor must emit
 * `lambda-change` only on a real user edit, never on the programmatic
 * `value`-prop sync. A reused editor re-pointed at a different field's
 * body (section switch driven by the YAML pane's cursor) would otherwise
 * echo a spurious change, dirty the form, and trigger a lossy
 * re-serialize of the whole section.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { ESPHomeLambdaEditor } from "../../../src/components/device/config-entry-renderers/lambda-editor.js";

async function mount(value: string): Promise<ESPHomeLambdaEditor> {
  const el = new ESPHomeLambdaEditor();
  el.value = value;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("lambda-editor lambda-change emission", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("does not emit on a programmatic value-prop sync", async () => {
    const el = await mount("return 1;");
    const onChange = vi.fn();
    el.addEventListener("lambda-change", onChange);

    // Simulate the section-switch reuse: the form re-points this editor
    // at a different field's body via the `value` prop.
    el.value = "return 2;";
    await el.updateComplete;

    expect(onChange).not.toHaveBeenCalled();
    // The doc still tracks the new value, it just doesn't echo it back.
    expect(el["_view"]!.state.doc.toString()).toBe("return 2;");
  });

  it("does not emit while mounting with an initial value", async () => {
    const el = new ESPHomeLambdaEditor();
    el.value = "return 1;";
    const onChange = vi.fn();
    // Listen *before* the first render so the initial value-sync is observed.
    el.addEventListener("lambda-change", onChange);
    document.body.appendChild(el);
    await el.updateComplete;

    expect(onChange).not.toHaveBeenCalled();
    expect(el["_view"]!.state.doc.toString()).toBe("return 1;");
  });

  it("stays silent across repeated programmatic syncs (feedback loop)", async () => {
    const el = await mount("return 1;");
    const onChange = vi.fn();
    el.addEventListener("lambda-change", onChange);

    for (const v of ["return 2;", "return 3;", "return 4;"]) {
      el.value = v;
      await el.updateComplete;
    }

    expect(onChange).not.toHaveBeenCalled();
  });

  it("emits exactly once on a user edit", async () => {
    const el = await mount("return 1;");
    const onChange = vi.fn();
    el.addEventListener("lambda-change", onChange);

    // A user edit is a doc change with no `externalSync` annotation.
    const view = el["_view"]!;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "return 42;" },
    });
    await el.updateComplete;

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].detail).toEqual({ value: "return 42;" });
  });

  it("suppresses a programmatic sync that follows a user edit", async () => {
    const el = await mount("return 1;");
    const onChange = vi.fn();
    el.addEventListener("lambda-change", onChange);

    // User types...
    const view = el["_view"]!;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "return 42;" },
    });
    await el.updateComplete;
    expect(onChange).toHaveBeenCalledTimes(1);

    // ...then the owner echoes a fresh value back through the prop: no emit.
    el.value = "return 99;";
    await el.updateComplete;
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(view.state.doc.toString()).toBe("return 99;");
  });
});
