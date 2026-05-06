import { describe, expect, it } from "vitest";
import { parsePinGpio } from "../../../src/components/device/config-entry-pin-renderer.js";

describe("parsePinGpio", () => {
  it("accepts bare integers", () => {
    expect(parsePinGpio(12)).toBe(12);
    expect(parsePinGpio(0)).toBe(0);
  });

  it("accepts GPIO-prefixed strings, case-insensitively", () => {
    expect(parsePinGpio("GPIO13")).toBe(13);
    expect(parsePinGpio("gpio5")).toBe(5);
    expect(parsePinGpio("  GPIO2  ")).toBe(2);
  });

  it("accepts plain numeric strings", () => {
    expect(parsePinGpio("7")).toBe(7);
    expect(parsePinGpio("0")).toBe(0);
  });

  it("extracts the GPIO from a long-form pin block", () => {
    // The Sonoff Basic front-panel button preset locks the pin as a
    // structured ESPHome pin block (number + mode + inverted). Without
    // recognising the `number` field the dropdown rendered blank even
    // though the underlying value was correct.
    expect(
      parsePinGpio({
        number: 0,
        mode: { input: true, pullup: true },
        inverted: true,
      }),
    ).toBe(0);
    expect(parsePinGpio({ number: 13 })).toBe(13);
    expect(parsePinGpio({ number: "GPIO4" })).toBe(4);
  });

  it("returns null for unparseable values", () => {
    expect(parsePinGpio(null)).toBeNull();
    expect(parsePinGpio(undefined)).toBeNull();
    expect(parsePinGpio("")).toBeNull();
    expect(parsePinGpio("not a pin")).toBeNull();
    expect(parsePinGpio({})).toBeNull();
    expect(parsePinGpio({ number: "nope" })).toBeNull();
    expect(parsePinGpio([])).toBeNull();
    expect(parsePinGpio(Number.NaN)).toBeNull();
  });
});

describe("renderPinField wa-select binding", () => {
  // The form's ``_syncSelectValues`` clears ``wa-select.value`` to
  // ``""`` for any non-primitive value (transient autocompletion
  // state, the long-form pin block, …). PIN renderers can
  // legitimately carry an object value
  // (``{ number: GPIO33, mode: INPUT_PULLUP, inverted: false }``),
  // so they MUST opt out of that generic sync via
  // ``data-no-value-sync`` — which routes the form to
  // ``_syncSelectedAttr`` instead. ``_syncSelectedAttr`` reads the
  // option Lit's ``?selected`` binding marked and pushes its
  // value onto the parent after wa-select's first paint; that's
  // the generic mechanism every "non-primitive value" renderer
  // uses (FLOAT_WITH_UNIT's unit picker is the other one), so
  // adding new structured shapes doesn't grow the form's
  // per-type knowledge.
  const importNode = async () => {
    const [fs, path, url] = await Promise.all([
      // @ts-expect-error — node-only module, types excluded from tsconfig
      import("node:fs"),
      // @ts-expect-error — node-only module, types excluded from tsconfig
      import("node:path"),
      // @ts-expect-error — node-only module, types excluded from tsconfig
      import("node:url"),
    ]);
    return { fs, path, url };
  };

  it("opts out of the generic sync via data-no-value-sync on the wa-select", async () => {
    const { fs, path, url } = await importNode();
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const sourcePath = path.resolve(
      here,
      "../../../src/components/device/config-entry-pin-renderer.ts",
    );
    const src = fs.readFileSync(sourcePath, "utf-8");
    const m = src.match(/<wa-select[^>]*?>/s);
    expect(m, "wa-select element missing from renderPinField").not.toBeNull();
    expect(
      /\bdata-no-value-sync\b/.test(m![0]),
      `wa-select missing data-no-value-sync; matched element: ${m![0]}`,
    ).toBe(true);
    // Pin the inverse: don't bind ``.value=`` on the parent. The
    // generic sync would clobber it (object value → cleared to
    // ""), and the ``data-no-value-sync`` path is the canonical
    // mechanism — having both creates two competing sources of
    // truth and confuses the next maintainer.
    expect(
      /\.value\s*=\s*\$\{/.test(m![0]),
      `wa-select binds .value= alongside data-no-value-sync; matched element: ${m![0]}`,
    ).toBe(false);
  });

  it("config-entry-form has no pin-specific knowledge in its generic sync", async () => {
    // The first iteration of this fix coerced object pin shapes
    // via ``parsePinGpio`` inside ``_syncSelectValues``. That
    // worked but leaked field-type-specific knowledge into the
    // generic helper — every future structured-value renderer
    // would need its own coercer there. The data-no-value-sync
    // refactor moves the responsibility back to the renderer
    // and the generic ``_syncSelectedAttr`` handles every such
    // field uniformly via ``wa-option[selected]``.
    const { fs, path, url } = await importNode();
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const sourcePath = path.resolve(
      here,
      "../../../src/components/device/config-entry-form.ts",
    );
    const src = fs.readFileSync(sourcePath, "utf-8");
    expect(
      /import\s*\{\s*parsePinGpio\s*\}/.test(src),
      "config-entry-form imports parsePinGpio — pin-specific knowledge has leaked back into the generic form",
    ).toBe(false);
    expect(
      /parsePinGpio\s*\(/.test(src),
      "config-entry-form calls parsePinGpio — pin-specific knowledge has leaked back into the generic form",
    ).toBe(false);
  });
});
