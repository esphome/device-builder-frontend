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
    // tsconfig restricts `types` to @types/w3c-web-serial, so node
    // module specifiers don't type-check; vitest resolves them fine.
    // @ts-ignore — node-only module
    const fs = await import("node:fs");
    // @ts-ignore — node-only module
    const path = await import("node:path");
    // @ts-ignore — node-only module
    const url = await import("node:url");
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const sourcePath = path.resolve(
      here,
      "../../../src/components/device/config-entry-renderers/primitives.ts"
    );
    const src = fs.readFileSync(sourcePath, "utf-8");

    // Carve out just ``renderBooleanField`` so we don't accidentally
    // match a fallback in another renderer. The function is short
    // but its rationale comment is long, so slice up to the next
    // ``export function`` boundary instead of a fixed offset.
    const startIdx = src.indexOf("export function renderBooleanField");
    expect(startIdx).toBeGreaterThan(-1);
    // When ``renderBooleanField`` is the last export in the file
    // there's no next-export sentinel; slice to end-of-file rather
    // than a fixed window so a future implementation that grows
    // past a hard-coded byte budget (extra comments, more guard
    // branches) still produces a complete carve-out instead of a
    // false failure when an assertion's anchor falls past the
    // truncation boundary.
    const nextExportIdx = src.indexOf("export function ", startIdx + 1);
    const fnSrc = src.slice(startIdx, nextExportIdx > 0 ? nextExportIdx : src.length);

    // The renderer must consult ``entry.default_value`` when
    // computing the value that drives ``checked`` — a bare reference
    // somewhere in the function body would pass even if ``checked``
    // were computed off ``raw`` alone (with ``entry.default_value``
    // mentioned in an unrelated expression). Pin a fallback shape
    // that lands the catalog default into a single intermediate
    // (commonly named ``effective``) before the boolean coercion.
    //
    // Accept either of the two shapes likely to be used:
    //
    //   const <name> = raw === undefined || raw === null
    //     ? entry.default_value : raw;
    //   const <name> = raw ?? entry.default_value;
    //
    // The ``checked`` line below must then derive from that
    // intermediate (or from ``entry.default_value`` directly), so
    // any future refactor that disconnects the two surfaces fails
    // this test.
    const fallbackShape =
      /=\s*raw\s*===\s*undefined\s*\|\|\s*raw\s*===\s*null\s*\?\s*entry\.default_value\s*:\s*raw/.test(
        fnSrc
      ) || /=\s*raw\s*\?\?\s*entry\.default_value/.test(fnSrc);
    expect(
      fallbackShape,
      "renderBooleanField must compute an intermediate that falls " +
        "back from raw to entry.default_value — default-true fields " +
        "otherwise render OFF when the YAML omits them"
    ).toBe(true);

    // The ``checked`` computation must depend on whichever value
    // wins the fallback (not just the raw). The renderer routes the
    // value through ``parseYamlBoolean`` so every ESPHome YAML
    // truthy spelling (``True`` / ``yes`` / ``on`` / ``enable``)
    // collapses to the boolean primitive before the strict-equality
    // compare — pin that shape so a stray refactor that drops the
    // lenient parser silently regresses the case where the form
    // value (or backend-supplied default) arrived as the uppercase
    // string ``"True"``.
    expect(
      /parseYamlBoolean\(.*\)\s*===\s*true\b/.test(fnSrc),
      "checked must route the fallback value through parseYamlBoolean " +
        "so all ESPHome YAML boolean spellings (True / yes / on / enable) " +
        "collapse to the boolean primitive — issue device-builder#923"
    ).toBe(true);

    // ``checked`` must be derived from the same value that consulted
    // ``entry.default_value`` — pin that the strict-equality check
    // doesn't operate on a bare ``raw``. Use a non-greedy span to
    // confirm there's at least one ``=== true`` after the
    // fallback intermediate's assignment, and confirm none of the
    // ``=== true`` lines compare against ``raw`` directly.
    expect(
      /raw\s*===\s*true\b/.test(fnSrc),
      "checked must be computed from the fallback intermediate, not raw directly"
    ).toBe(false);
  });
});
