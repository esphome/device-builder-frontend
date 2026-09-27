import { expect, vi } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Picks ``file`` in a file-driven install dialog and waits for it to be read
 * and checked, as the dialog does before it offers the install. ``field`` is
 * the dialog's ``Preparation``.
 */
export async function pickFile(el: any, field: string, file: File | null): Promise<void> {
  el._onFileChange({ target: { files: file ? [file] : [] } });
  await vi.waitFor(() => expect(el[field].state.kind).not.toBe("pending"));
  // A dialog driven without being mounted never completes an update.
  if (el.isConnected) await el.updateComplete;
}

/** A file whose read stays pending until the test ends it. */
export function slowFile(name: string): {
  file: File;
  read: (bytes: ArrayBuffer) => void;
  fail: (err: Error) => void;
} {
  let read!: (bytes: ArrayBuffer) => void;
  let fail!: (err: Error) => void;
  const pending = new Promise<ArrayBuffer>((resolve, reject) => {
    read = resolve;
    fail = reject;
  });
  return { file: { name, arrayBuffer: () => pending } as unknown as File, read, fail };
}

/** What the shared file picker shows under the input. */
export const pickerText = (el: any) => ({
  name: el.shadowRoot!.querySelector(".file-name")?.textContent?.trim() ?? "",
  status:
    el
      .shadowRoot!.querySelector(".file-status:not(.file-status--error)")
      ?.textContent?.trim() ?? "",
  error: el.shadowRoot!.querySelector(".file-status--error")?.textContent?.trim() ?? "",
});

/** Records what the dialog's file input is set to; a real one only takes "". */
export function watchFileInput(el: any) {
  const input = el.shadowRoot!.querySelector("input[type=file]") as HTMLInputElement;
  const set = vi.fn();
  Object.defineProperty(input, "value", { configurable: true, set, get: () => "" });
  return set;
}
