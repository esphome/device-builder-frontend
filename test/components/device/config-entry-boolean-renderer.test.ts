/**
 * Source-scan tests for ``renderBooleanField``. The renderer
 * imports Lit decorators that need DOM globals (vitest runs in
 * ``node``), so we can't render it here. Instead pin the
 * default-value contract by inspecting the source — a future
 * refactor that drops the ``default_value`` fallback would
 * silently regress the
 * ``esp32_ble_tracker.software_coexistence`` case where the
 * catalog ships ``default_value: true`` and the YAML omits the
 * field, so the toggle should render ON.
 */
import { describe, expect, it } from "vitest";

describe("renderBooleanField default-value fallback", () => {
  it("treats undefined / null raw as ``entry.default_value`` when computing checked state", async () => {
    // @ts-expect-error — node-only module, types excluded from tsconfig
    const fs = await import("node:fs");
    // @ts-expect-error — node-only module, types excluded from tsconfig
    const path = await import("node:path");
    // @ts-expect-error — node-only module, types excluded from tsconfig
    const url = await import("node:url");
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const sourcePath = path.resolve(
      here,
      "../../../src/components/device/config-entry-renderers.ts",
    );
    const src = fs.readFileSync(sourcePath, "utf-8");

    // Carve out just ``renderBooleanField`` so we don't accidentally
    // match a fallback in another renderer. The function is short
    // but its rationale comment is long, so slice up to the next
    // ``export function`` boundary instead of a fixed offset.
    const startIdx = src.indexOf("export function renderBooleanField");
    expect(startIdx).toBeGreaterThan(-1);
    const nextExportIdx = src.indexOf("export function ", startIdx + 1);
    const fnSrc = src.slice(
      startIdx,
      nextExportIdx > 0 ? nextExportIdx : startIdx + 2000,
    );

    // The renderer must consult ``entry.default_value`` when the
    // raw value is unset. Accept any nullish-fallback expression
    // (``?? entry.default_value``, an explicit
    // ``raw === undefined || raw === null ? entry.default_value : raw``,
    // …) so future refactors can pick whichever shape is cleanest
    // without breaking this pin.
    const referencesDefaultValue = /entry\.default_value/.test(fnSrc);
    expect(
      referencesDefaultValue,
      "renderBooleanField doesn't fall back to entry.default_value — " +
        "default-true fields render OFF when the YAML omits them",
    ).toBe(true);

    // And the checked computation must depend on whichever value
    // wins the fallback (not just the raw). Pin a strict-equality
    // check against ``true`` (or its quoted form) so a stray
    // truthy coercion doesn't silently change semantics. Match
    // both ``=== true`` and ``=== "true"`` separately so the
    // assertion fails loudly if either is dropped.
    expect(/===\s*true\b/.test(fnSrc)).toBe(true);
    expect(/===\s*"true"/.test(fnSrc)).toBe(true);
  });
});
