/** Freeze *el* while it shows content that is about to be replaced:
 *  inert for input and aria-busy for assistive tech. */
export function setHeld(el: HTMLElement, held: boolean): void {
  if (el.inert === held) return;
  el.inert = held;
  el.ariaBusy = held ? "true" : null;
}
