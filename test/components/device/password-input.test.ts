import { describe, expect, it } from "vitest";
import {
  PASSWORD_INPUT_VALUE_CHANGE_EVENT,
  buildPasswordValueChangeEvent,
  type PasswordInputValueChange,
} from "../../../src/components/device/password-input-event.js";

describe("password-input event contract", () => {
  // Pins the wire name and detail shape against the same builder
  // the component uses. A rename here (e.g. someone reverting to
  // `"input"` or `"value-change"`) trips the test in lockstep
  // instead of silently leaving every consumer's listener with
  // no firing event.

  it("uses the password-input-change wire name", () => {
    expect(PASSWORD_INPUT_VALUE_CHANGE_EVENT).toBe("password-input-change");
  });

  it("does not regress to the colliding 'input' name", () => {
    // An earlier version dispatched as `input`, which collided
    // with the native InputEvent bubbling out of the inner
    // `<input>` — host-level `@input` listeners ran twice and
    // the second run wiped the just-typed value.
    expect(PASSWORD_INPUT_VALUE_CHANGE_EVENT).not.toBe("input");
  });

  it("does not regress to the form-colliding 'value-change' name", () => {
    // The config-entry form already fires `value-change` with a
    // `{path, value}` detail; if the password input bubbled a
    // `{value}`-only event under the same name, a parent form
    // listener would crash on the missing `path` field.
    expect(PASSWORD_INPUT_VALUE_CHANGE_EVENT).not.toBe("value-change");
  });

  it("builds a non-bubbling, non-composed CustomEvent with {value} detail", () => {
    // Bubbling buys nothing here — every consumer pattern is a
    // direct `@password-input-change` listener on the
    // `<esphome-password-input>` element. Non-bubbling +
    // non-composed structurally prevents collisions with parent
    // listeners listening for like-named events.
    const e = buildPasswordValueChangeEvent("hunter2");
    expect(e.type).toBe("password-input-change");
    expect(e.bubbles).toBe(false);
    expect(e.composed).toBe(false);
    expect(e.detail).toEqual({ value: "hunter2" } satisfies PasswordInputValueChange);
  });

  it("reaches a direct EventTarget listener", () => {
    const target = new EventTarget();
    const seen: Array<CustomEvent<PasswordInputValueChange>> = [];
    target.addEventListener(PASSWORD_INPUT_VALUE_CHANGE_EVENT, (e) =>
      seen.push(e as CustomEvent<PasswordInputValueChange>)
    );
    target.dispatchEvent(buildPasswordValueChangeEvent("secret"));
    expect(seen).toHaveLength(1);
    expect(seen[0].detail.value).toBe("secret");
  });

  it("emits empty string when the input is cleared", () => {
    const e = buildPasswordValueChangeEvent("");
    expect(e.detail.value).toBe("");
  });
});
