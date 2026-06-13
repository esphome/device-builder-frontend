/**
 * Event contract for `<esphome-options-combobox>` — kept separate from the
 * component so test code can import the builder / wire name without pulling
 * in Lit + the webawesome style-sheet polyfill the component registers
 * eagerly (which fails in a Node test environment). The component imports
 * from here in lockstep, so a rename or detail-shape change fails to compile
 * both sites.
 */

/** Detail shape of the `options-combobox-change` event. */
export interface OptionsComboboxValueChange {
  value: string;
}

/**
 * Wire name for the combobox's change event.
 *
 * Deliberately namespaced and non-bubbling: a generic, bubbling
 * `value-change(d)` would collide with the config-entry form's own
 * `value-change` event (a `{path, value}` detail), letting this
 * `{value}`-only detail reach a parent form listener expecting `{path}`.
 */
export const OPTIONS_COMBOBOX_CHANGE_EVENT = "options-combobox-change";

/**
 * Build the change event the component fires. Non-bubbling, non-composed:
 * the only consumer is a direct `@options-combobox-change` listener on the
 * element, so bubbling buys nothing and invites collisions. Direct listeners
 * fire regardless of `bubbles`.
 */
export function buildOptionsComboboxChangeEvent(
  value: string
): CustomEvent<OptionsComboboxValueChange> {
  return new CustomEvent<OptionsComboboxValueChange>(OPTIONS_COMBOBOX_CHANGE_EVENT, {
    detail: { value },
    bubbles: false,
    composed: false,
  });
}
