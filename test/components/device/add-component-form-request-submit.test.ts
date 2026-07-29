/**
 * @vitest-environment happy-dom
 *
 * requestSubmit() (the dialog's Enter path, #2400) runs the same submit
 * path as the Add button but self-guards on an in-flight submit — the
 * button's ?disabled only protects the click path.
 */
import { describe, expect, it, vi } from "vitest";

import "../../_mock-webawesome.js";

import { ESPHomeAddComponentForm } from "../../../src/components/device/add-component-form.js";

function makeForm(): {
  form: ESPHomeAddComponentForm;
  onSubmit: ReturnType<typeof vi.fn>;
} {
  const form = new ESPHomeAddComponentForm();
  const onSubmit = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (form as any)._onSubmit = onSubmit;
  return { form, onSubmit };
}

describe("add-component-form requestSubmit guard (#2400)", () => {
  it("runs the submit path when idle", () => {
    const { form, onSubmit } = makeForm();
    form.requestSubmit();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("ignores a request while a submit is in flight", () => {
    const { form, onSubmit } = makeForm();
    form.submitting = true;
    form.requestSubmit();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
