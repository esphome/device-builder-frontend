import { describe, expect, it } from "vitest";
import {
  PASSWORD_INPUT_VALUE_CHANGE_EVENT,
  buildPasswordValueChangeEvent,
  type PasswordInputValueChange,
} from "../../../src/components/device/password-input-event.js";

describe("password-input value-change event contract", () => {
  // Pins the wire name and detail shape against the same builder
  // the component uses. A rename here (e.g. someone reverting to
  // `"input"`) trips the test in lockstep instead of silently
  // leaving every consumer's `@value-change` listener with no
  // firing event.

  it("uses the value-change wire name", () => {
    expect(PASSWORD_INPUT_VALUE_CHANGE_EVENT).toBe("value-change");
  });

  it("does not regress to the colliding 'input' name", () => {
    // Earlier version dispatched as `input`, which collided with
    // the native InputEvent bubbling out of the inner `<input>`
    // — host-level `@input` listeners ran twice and the second
    // run wiped the just-typed value. Pin that we never go back.
    expect(PASSWORD_INPUT_VALUE_CHANGE_EVENT).not.toBe("input");
  });

  it("builds a bubbling, composed CustomEvent with {value} detail", () => {
    const e = buildPasswordValueChangeEvent("hunter2");
    expect(e.type).toBe("value-change");
    expect(e.bubbles).toBe(true);
    expect(e.composed).toBe(true);
    expect(e.detail).toEqual({ value: "hunter2" } satisfies PasswordInputValueChange);
  });

  it("propagates an EventTarget listener with the right name + detail", () => {
    // Real EventTarget exists in Node, so we can verify the
    // builder's event reaches a listener registered under the
    // same wire name we tell consumers to use. If the wire name
    // and the constant ever drift, no listener fires.
    const target = new EventTarget();
    const seen: Array<CustomEvent<PasswordInputValueChange>> = [];
    target.addEventListener(PASSWORD_INPUT_VALUE_CHANGE_EVENT, (e) =>
      seen.push(e as CustomEvent<PasswordInputValueChange>),
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
