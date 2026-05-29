/** Dispatch a plain Enter keydown on the window, the event shape the
 *  dialogs' EnterController listens for. Shared so the spec line lives in
 *  one place across the dialog/wizard tests. */
export function pressEnter(): void {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      composed: true,
    })
  );
}
