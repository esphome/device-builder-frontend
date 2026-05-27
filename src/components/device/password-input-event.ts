/**
 * Event-contract definitions for `<esphome-password-input>` —
 * separate from the component itself so test code can import the
 * builder without pulling in Lit's DOM dependencies (the
 * webawesome CSS-style-sheet polyfill that the component
 * registers eagerly fails in a Node test environment).
 *
 * The component imports from here in lockstep, so a rename or
 * detail-shape change at one site fails to compile both places.
 */

/**
 * Detail shape of the `password-input-change` event the password
 * input fires when the user types. Re-exported from
 * `password-input.ts` so consumers can keep a single import path
 * for the component + its event type.
 */
export interface PasswordInputValueChange {
  value: string;
}

/**
 * Wire name for the change event the password input emits.
 * Pinned in the test so a rename here trips the contract check
 * instead of silently leaving consumer `@password-input-change`
 * listeners with no firing event.
 *
 * Deliberately *not* `"input"` — that would collide with the
 * native InputEvent that bubbles out of the inner `<input>` and
 * a host-level listener would see both back-to-back. Also
 * deliberately *not* `"value-change"` — that's the wire name the
 * config-entry form already uses for its own value-change events
 * (with a `{path, value}` detail), and a generic name on a
 * bubbling event would let the password's `{value}`-only detail
 * reach a parent form listener that's expecting `{path}` and
 * crash.
 */
export const PASSWORD_INPUT_VALUE_CHANGE_EVENT = "password-input-change";

/**
 * Build the `password-input-change` `CustomEvent` the component
 * fires. Extracted so the test can pin both the wire name and
 * the detail shape against the same builder the component uses.
 *
 * Non-bubbling, non-composed: the only consumer pattern is a
 * direct `@password-input-change` listener on the
 * `<esphome-password-input>` element, so bubbling buys nothing
 * and would only invite collisions with parent listeners. Direct
 * listeners fire regardless of `bubbles`.
 */
export function buildPasswordValueChangeEvent(
  value: string
): CustomEvent<PasswordInputValueChange> {
  return new CustomEvent<PasswordInputValueChange>(PASSWORD_INPUT_VALUE_CHANGE_EVENT, {
    detail: { value },
    bubbles: false,
    composed: false,
  });
}
