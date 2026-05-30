/** Dispatch a plain Enter keydown on the window, the event shape the
 *  dialogs' EnterController listens for. Shared so the spec line lives in
 *  one place across the dialog/wizard tests. Pass ``{ repeat: true }`` to
 *  simulate an OS key-repeat keydown (a held key), which the wizard step
 *  ignores so a single hold can't cross a stage boundary. */
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
