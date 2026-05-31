/** Dispatch a plain Enter keydown on the window, the event shape the
 *  dialogs' EnterController listens for. Pass `{ repeat: true }` to simulate
 *  an OS key-repeat (a held key). */
export function pressEnter(options: { repeat?: boolean } = {}): void {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      composed: true,
      repeat: options.repeat ?? false,
    })
  );
}
