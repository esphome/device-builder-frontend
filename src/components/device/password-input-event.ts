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
 * Detail shape of the `value-change` event the password input
 * fires when the user types. Re-exported from `password-input.ts`
 * so consumers can keep a single import path for the component +
 * its event type.
 */
export interface PasswordInputValueChange {
  value: string;
}

/**
 * Wire name for the value-change event the password input emits.
 * Pinned in the test so a rename here trips the contract check
 * instead of silently leaving consumer `@value-change` listeners
 * with no firing event.
 *
 * Deliberately *not* `"input"` — that would collide with the
 * native InputEvent that bubbles out of the inner `<input>` and
 * a host-level listener would see both back-to-back.
 */
export const PASSWORD_INPUT_VALUE_CHANGE_EVENT = "value-change";

/**
 * Build the `value-change` `CustomEvent` the component fires.
 * Extracted so the test can pin both the wire name and the
 * detail shape against the same builder the component uses.
 */
export function buildPasswordValueChangeEvent(
  value: string,
): CustomEvent<PasswordInputValueChange> {
  return new CustomEvent<PasswordInputValueChange>(
    PASSWORD_INPUT_VALUE_CHANGE_EVENT,
    {
      detail: { value },
      bubbles: true,
      composed: true,
    },
  );
}
