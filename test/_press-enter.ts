/** Dispatch a plain Enter keydown on the window, the event shape the
 *  dialogs' EnterController listens for. Pass `{ repeat: true }` to simulate
 *  an OS key-repeat (a held key). Returns the event so callers can assert
 *  whether a controller claimed it (`defaultPrevented`). */
export function pressEnter(options: { repeat?: boolean } = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
    composed: true,
    repeat: options.repeat ?? false,
  });
  window.dispatchEvent(event);
  return event;
}
