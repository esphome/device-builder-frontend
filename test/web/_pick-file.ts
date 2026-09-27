import { expect, vi } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Picks ``file`` in a file-driven install dialog and waits for it to be read
 * and checked, as the dialog does before it offers the install. ``field`` is
 * the dialog's ``FilePreparation``.
 */
export async function pickFile(el: any, field: string, file: File | null): Promise<void> {
  el._onFileChange({ target: { files: file ? [file] : [] } });
  await vi.waitFor(() => expect(el[field].state.kind).not.toBe("pending"));
  // A dialog driven without being mounted never completes an update.
  if (el.isConnected) await el.updateComplete;
}
