/** Ends the key of a pin's Advanced panel in the form's open groups. */
export const PIN_ADVANCED_SUFFIX = ":pin-advanced";

/** Close every pin's Advanced panel in *stores*, the form's open groups
 *  and the marks of the ones it opened on its own. */
export function closePinAdvanced(...stores: Set<string>[]): void {
  for (const store of stores) {
    for (const key of [...store]) {
      if (key.endsWith(PIN_ADVANCED_SUFFIX)) store.delete(key);
    }
  }
}
