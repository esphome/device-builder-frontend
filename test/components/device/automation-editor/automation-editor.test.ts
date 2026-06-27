/**
 * Source-scan tests for ``automation-editor.ts`` — the
 * auto-apply + delete + revert pattern is the security-sensitive
 * surface here. The Lit element imports CodeMirror through the
 * lambda editor, so we can't mount it in vitest; pin the
 * source-level shape instead.
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
      "../../../../src/components/device/automation-editor/automation-editor.ts"
    ),
    "utf-8"
  );
}

describe("automation-editor auto-apply / delete contract", () => {
  it("auto-apply path wraps upsertAutomation in try/catch with a toast.error on failure", async () => {
    const src = await readSource();
    // ``_autoApply`` is the new entry point — debounced upsert
    // that pushes the YAML diff up via the ``yaml-draft`` event.
    // It must guard the backend call with try/catch + toast so a
    // failed write reaches the user instead of silently dropping.
    const onIdx = src.indexOf("async _autoApply");
    expect(onIdx).toBeGreaterThan(-1);
    const after = src.slice(onIdx);
    const nextSibling = after.search(/\n\s*(public|private)\s+_/);
    const slice = nextSibling > 0 ? after.slice(0, nextSibling) : after;
    const tryIdx = slice.indexOf("try {");
    const upsertIdx = slice.indexOf("upsertAutomation");
    const catchIdx = slice.indexOf("} catch");
    const toastIdx = slice.indexOf("toast.error");
    const finallyIdx = slice.indexOf("} finally {");
    expect(tryIdx).toBeGreaterThan(-1);
    expect(upsertIdx).toBeGreaterThan(tryIdx);
    expect(catchIdx).toBeGreaterThan(upsertIdx);
    expect(toastIdx).toBeGreaterThan(catchIdx);
    expect(finallyIdx).toBeGreaterThan(toastIdx);
  });

  it("auto-apply dispatches the resulting YAML via yaml-draft so the page advances _yaml", async () => {
    const src = await readSource();
    // After the upsert returns a YamlDiff we have to splice it
    // into the page's YAML buffer ourselves (the backend doesn't
    // write to disk — the global save button does). ``yaml-draft``
    // is the page's existing draft-update event.
    const onIdx = src.indexOf("async _autoApply");
    const after = src.slice(onIdx);
    const nextSibling = after.search(/\n\s*(public|private)\s+_/);
    const slice = nextSibling > 0 ? after.slice(0, nextSibling) : after;
    expect(slice).toMatch(/applyYamlDiff\(/);
    expect(slice).toMatch(/"yaml-draft"/);
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

  it("delete writes to disk via updateConfig and dispatches yaml-updated", async () => {
    const src = await readSource();
    // Component-editor parity: delete is final and writes through
    // immediately (not a draft). Page's _onYamlUpdated advances
    // both _yaml AND _savedYaml — clean state.
    const onDeleteIdx = src.indexOf("_onDelete = async");
    const after = src.slice(onDeleteIdx);
    const nextSibling = after.search(/\n\s*private\s+_on/);
    const slice = nextSibling > 0 ? after.slice(0, nextSibling) : after;
    expect(slice).toMatch(/updateConfig\(/);
    expect(slice).toMatch(/"yaml-updated"/);
  });

  it("exposes an `inFlightWrite` getter for the parent's reconnect guard", async () => {
    const src = await readSource();
    expect(/get\s+inFlightWrite\s*\(\s*\)\s*:\s*boolean/.test(src)).toBe(true);
    // Must read both _deleting AND _applyInFlight so a write in
    // either path gates the parent's post-reconnect reload.
    const m = src.match(/get\s+inFlightWrite[\s\S]*?return\s+([^;]+);/);
    expect(m).not.toBeNull();
    const body = m![1];
    expect(body.includes("_deleting")).toBe(true);
    expect(body.includes("_applyInFlight")).toBe(true);
  });
});
