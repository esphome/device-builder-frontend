/**
 * Source-scan tests for ``automation-editor.ts`` — the optimistic
 * save + delete + revert pattern is the security-sensitive surface
 * here. The Lit element imports CodeMirror through the lambda
 * editor, so we can't mount it in vitest; pin the source-level
 * shape instead.
 */
import { describe, expect, it } from "vitest";

async function readSource(): Promise<string> {
  // @ts-ignore — node-only module
  const fs = await import("node:fs");
  // @ts-ignore — node-only module
  const path = await import("node:path");
  // @ts-ignore — node-only module
  const url = await import("node:url");
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  return fs.readFileSync(
    path.resolve(
      here,
      "../../../../src/components/device/automation-editor/automation-editor.ts",
    ),
    "utf-8",
  );
}

describe("automation-editor save / delete contract", () => {
  it("wraps the upsert call in try/catch with a toast.error on failure", async () => {
    const src = await readSource();
    // Pin the method body (``_onSave = async () => {``) not the
    // template reference (``@click=${this._onSave}``).
    const onSaveIdx = src.indexOf("_onSave = async");
    expect(onSaveIdx).toBeGreaterThan(-1);
    // Slice just the function body — from the method assignment
    // up to the next ``private _on…`` declaration so a catch / toast
    // in a later sibling method can't pollute our index checks.
    const after = src.slice(onSaveIdx);
    const nextSibling = after.search(/\n\s*private\s+_on/);
    const slice = nextSibling > 0 ? after.slice(0, nextSibling) : after;
    const tryIdx = slice.indexOf("try {");
    const upsertIdx = slice.indexOf("upsertAutomation");
    const catchIdx = slice.indexOf("} catch");
    const toastIdx = slice.indexOf("toast.error");
    const finallyIdx = slice.indexOf("} finally {");
    const clearIdx = slice.indexOf("_saving = false");
    expect(tryIdx).toBeGreaterThan(-1);
    expect(upsertIdx).toBeGreaterThan(tryIdx);
    expect(catchIdx).toBeGreaterThan(upsertIdx);
    expect(toastIdx).toBeGreaterThan(catchIdx);
    expect(finallyIdx).toBeGreaterThan(toastIdx);
    expect(clearIdx).toBeGreaterThan(finallyIdx);
  });

  it("wraps the delete call in try/catch with a toast.error on failure", async () => {
    const src = await readSource();
    const onDeleteIdx = src.indexOf("_onDelete = async");
    expect(onDeleteIdx).toBeGreaterThan(-1);
    const after = src.slice(onDeleteIdx);
    const nextSibling = after.search(/\n\s*private\s+_on/);
    const slice = nextSibling > 0 ? after.slice(0, nextSibling) : after;
    const tryIdx = slice.indexOf("try {");
    const deleteIdx = slice.indexOf("deleteAutomation");
    const catchIdx = slice.indexOf("} catch");
    const toastIdx = slice.indexOf("toast.error");
    const finallyIdx = slice.indexOf("} finally {");
    const clearIdx = slice.indexOf("_deleting = false");
    expect(tryIdx).toBeGreaterThan(-1);
    expect(deleteIdx).toBeGreaterThan(tryIdx);
    expect(catchIdx).toBeGreaterThan(deleteIdx);
    expect(toastIdx).toBeGreaterThan(catchIdx);
    expect(finallyIdx).toBeGreaterThan(toastIdx);
    expect(clearIdx).toBeGreaterThan(finallyIdx);
  });

  it("exposes an `inFlightWrite` getter for the parent's reconnect guard", async () => {
    const src = await readSource();
    expect(/get\s+inFlightWrite\s*\(\s*\)\s*:\s*boolean/.test(src)).toBe(true);
    // Must read both _saving AND _deleting so a delete-in-flight
    // also gates the parent's post-reconnect reload.
    const m = src.match(/get\s+inFlightWrite[\s\S]*?return\s+([^;]+);/);
    expect(m).not.toBeNull();
    const body = m![1];
    expect(body.includes("_saving")).toBe(true);
    expect(body.includes("_deleting")).toBe(true);
  });
});
