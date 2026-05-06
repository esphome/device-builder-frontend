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
  // Pin a contract that's invisible to ``parsePinGpio``'s unit
  // tests but is the actual user-facing bug: ``wa-select`` reads
  // its displayed value from the parent's ``value`` property, not
  // from per-option ``?selected`` attributes — those are only
  // honored on the initial slot-change pass and don't propagate
  // on re-render. With only ``?selected``, a pin block like
  // ``pin: { number: GPIO33, mode: INPUT_PULLUP, inverted: false }``
  // parses correctly (parsePinGpio → 33) but the closed select
  // displays nothing because the value never reaches the parent.
  it("binds .value on the parent wa-select so the closed display matches the selection", async () => {
    // @ts-expect-error — node-only module, types excluded from tsconfig
    const fs = await import("node:fs");
    // @ts-expect-error — node-only module, types excluded from tsconfig
    const path = await import("node:path");
    // @ts-expect-error — node-only module, types excluded from tsconfig
    const url = await import("node:url");
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const sourcePath = path.resolve(
      here,
      "../../../src/components/device/config-entry-pin-renderer.js"
        .replace(/\.js$/, ".ts"),
    );
    const src = fs.readFileSync(sourcePath, "utf-8");
    // The wa-select inside renderPinField must carry a property
    // binding to ``value`` (Lit's ``.value=`` syntax) so re-renders
    // update the displayed selection. Without it, an object pin
    // block (``{ number: GPIO33, ... }``) parses correctly but the
    // dropdown shows blank — the regression this test pins.
    const m = src.match(/<wa-select[^>]*?>/s);
    expect(m, "wa-select element missing from renderPinField").not.toBeNull();
    expect(
      /\.value\s*=\s*\$\{value\}/.test(m![0]),
      `wa-select doesn't bind .value=\${value}; matched element: ${m![0]}`,
    ).toBe(true);
  });
});
