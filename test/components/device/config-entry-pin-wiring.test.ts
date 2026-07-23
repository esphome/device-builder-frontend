/**
 * Template-shape tests for the pin wiring preset UI, driven through
 * ``renderPinField`` like the other pin renderer suites. Cards are
 * looked up by their ``data-preset`` binding; walker and fixtures are
 * shared with the sibling tests.
 */
import { describe, expect, it } from "vitest";
import { ConfigEntryType, PinMode } from "../../../src/api/types/config-entries.js";
import type { ConfigEntry } from "../../../src/api/types/config-entries.js";
import { renderPinField } from "../../../src/components/device/config-entry-pin-renderer.js";
import type { RenderCtx } from "../../../src/components/device/config-entry-renderers-shared.js";
import { findTemplatesByAnchor } from "../../_lit-template-walker.js";
import {
  findElementBindings,
  makeBoardPin,
  makeEntry,
  makeRenderCtx,
  makeTestBoard,
} from "./_renderer-fixtures.js";

const flag = (key: string, label: string) =>
  makeEntry(ConfigEntryType.BOOLEAN, { key, label, advanced: true });

const modeChild = () =>
  makeEntry(ConfigEntryType.NESTED, {
    key: "mode",
    label: "Mode",
    advanced: true,
    config_entries: [
      flag("input", "Input"),
      flag("output", "Output"),
      flag("pullup", "Pullup"),
      flag("pulldown", "Pulldown"),
      flag("open_drain", "Open Drain"),
    ],
  });

const invertedChild = () =>
  makeEntry(ConfigEntryType.BOOLEAN, {
    key: "inverted",
    label: "Inverted",
    advanced: true,
  });

const wiringPinEntry = (pinMode: PinMode, overrides: Partial<ConfigEntry> = {}) =>
  makeEntry(ConfigEntryType.PIN, {
    key: "pin",
    label: "Pin",
    required: true,
    pin_features: [],
    pin_mode: pinMode,
    config_entries: [modeChild(), invertedChild()],
    ...overrides,
  });

const openCtx = (pin: unknown, overrides: Partial<RenderCtx> = {}) =>
  makeRenderCtx(
    { pin },
    {
      overrides: {
        sectionKey: "binary_sensor.gpio",
        nestedOpenSections: new Set(["pin:pin-advanced"]),
        ...overrides,
      },
    }
  );

const cards = (result: unknown) =>
  findElementBindings(result, "button").filter((b) => "data-preset" in b);
const cardById = (result: unknown, id: string) =>
  cards(result).find((b) => b["data-preset"] === id);

describe("pin wiring preset cards", () => {
  it("renders the input preset set plus Custom for pin_mode input", () => {
    const result = renderPinField(
      wiringPinEntry(PinMode.INPUT),
      ["pin"],
      openCtx({ number: "GPIO2" })
    );
    expect(new Set(cards(result).map((c) => c["data-preset"]))).toEqual(
      new Set(["ground_switch", "vcc_switch", "driven_signal", "custom"])
    );
  });

  it("renders the output preset set for pin_mode output", () => {
    const result = renderPinField(
      wiringPinEntry(PinMode.OUTPUT),
      ["pin"],
      openCtx({ number: "GPIO2" })
    );
    expect(new Set(cards(result).map((c) => c["data-preset"]))).toEqual(
      new Set(["output_standard", "output_active_low", "output_open_drain", "custom"])
    );
  });

  it("keeps the raw disclosure for a directionless pin field", () => {
    const result = renderPinField(
      wiringPinEntry(PinMode.INPUT_OUTPUT),
      ["pin"],
      openCtx({ number: "GPIO2" })
    );
    expect(cards(result)).toHaveLength(0);
  });

  it("keeps the raw disclosure on a non-gpio platform (data-line pin)", () => {
    // An addressable LED strip's pin is a protocol data line; wiring
    // cards like "active low output" would mislead there.
    const result = renderPinField(
      wiringPinEntry(PinMode.OUTPUT),
      ["pin"],
      openCtx({ number: "GPIO2" }, { sectionKey: "light.esp32_rmt_led_strip" })
    );
    expect(cards(result)).toHaveLength(0);
  });

  it("reveals the mode flags without the global Show-advanced toggle", () => {
    // The wiring disclosure is itself the advanced gate; without the
    // strip, the raw-path Mode group rendered as an empty box while the
    // global toggle was off (the flag children are catalog-advanced).
    const ctx = openCtx(
      { number: "GPIO2", mode: {} },
      { sectionKey: "light.esp32_rmt_led_strip", showAdvanced: false }
    );
    renderPinField(wiringPinEntry(PinMode.OUTPUT), ["pin"], ctx);

    expect(ctx.renderEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "mode",
        config_entries: expect.arrayContaining([
          expect.objectContaining({ key: "pullup", advanced: false }),
        ]),
      }),
      ["pin", "mode"]
    );
  });

  it("keeps the raw disclosure for an expander-provided pin", () => {
    const result = renderPinField(
      wiringPinEntry(PinMode.INPUT),
      ["pin"],
      openCtx(
        { pca9554: "hub", number: 0, mode: "OUTPUT" },
        { pinRegistryModes: { pca9554: ["input", "output"] } }
      )
    );
    expect(cards(result)).toHaveLength(0);
  });

  it("marks the platform-default card active on an untouched pin", () => {
    const result = renderPinField(
      wiringPinEntry(PinMode.OUTPUT),
      ["pin"],
      openCtx({ number: "GPIO2" })
    );
    expect(cardById(result, "output_standard")?.["aria-checked"]).toBe("true");
    expect(cardById(result, "output_active_low")?.["aria-checked"]).toBe("false");
  });

  it("selects the card matching the stored flags", () => {
    const result = renderPinField(
      wiringPinEntry(PinMode.INPUT),
      ["pin"],
      openCtx({ number: "GPIO2", mode: { input: true, pullup: true }, inverted: true })
    );
    expect(cardById(result, "ground_switch")?.["aria-checked"]).toBe("true");
    expect(cardById(result, "vcc_switch")?.["aria-checked"]).toBe("false");
  });

  it("selects through a scalar mode shorthand", () => {
    const result = renderPinField(
      wiringPinEntry(PinMode.INPUT),
      ["pin"],
      openCtx({ number: "GPIO2", mode: "INPUT_PULLUP" })
    );
    expect(cardById(result, "ground_switch")?.["aria-checked"]).toBe("true");
  });

  it("writes the full long-form block when a preset is picked", () => {
    const ctx = openCtx({ number: "GPIO2" });
    const result = renderPinField(wiringPinEntry(PinMode.INPUT), ["pin"], ctx);

    (cardById(result, "ground_switch")!["@click"] as () => void)();

    expect(ctx.emitChange).toHaveBeenCalledWith(["pin"], {
      number: "GPIO2",
      mode: { input: true, pullup: true },
      inverted: true,
    });
  });

  it("preserves unrelated long-form keys on a preset pick", () => {
    const ctx = openCtx({
      number: "GPIO2",
      allow_other_uses: true,
      mode: { output: true },
    });
    const result = renderPinField(wiringPinEntry(PinMode.INPUT), ["pin"], ctx);

    (cardById(result, "driven_signal")!["@click"] as () => void)();

    expect(ctx.emitChange).toHaveBeenCalledWith(["pin"], {
      number: "GPIO2",
      allow_other_uses: true,
      mode: { input: true },
    });
  });

  it("picking Custom opens the editor without touching the YAML", () => {
    const ctx = openCtx({ number: "GPIO2" });
    const result = renderPinField(wiringPinEntry(PinMode.INPUT), ["pin"], ctx);

    (cardById(result, "custom")!["@click"] as () => void)();

    expect(ctx.setClusterChoice).toHaveBeenCalledWith("pin:pin-wiring", "custom");
    expect(ctx.emitChange).not.toHaveBeenCalled();
  });
});

describe("pin wiring seeding (preconfigured boards stay quiet)", () => {
  it("does not seed open when the flags match a preset", () => {
    const ctx = makeRenderCtx(
      { pin: { number: "GPIO2", mode: { input: true, pullup: true }, inverted: true } },
      {
        overrides: {
          sectionKey: "binary_sensor.gpio",
          scopeValues: () => ({ mode: { input: true, pullup: true } }),
        },
      }
    );
    renderPinField(wiringPinEntry(PinMode.INPUT), ["pin"], ctx);
    expect(ctx.seedNestedOpen).not.toHaveBeenCalled();
  });

  it("seeds open for a flag combination no preset names", () => {
    const ctx = makeRenderCtx(
      { pin: { number: "GPIO2", mode: { input: true, pullup: true, pulldown: true } } },
      {
        overrides: {
          sectionKey: "binary_sensor.gpio",
          scopeValues: () => ({ mode: { input: true, pullup: true, pulldown: true } }),
        },
      }
    );
    renderPinField(wiringPinEntry(PinMode.INPUT), ["pin"], ctx);
    expect(ctx.seedNestedOpen).toHaveBeenCalledWith("pin:pin-advanced");
  });

  it("renders no wiring section at all for a locked default pin", () => {
    const result = renderPinField(
      wiringPinEntry(PinMode.INPUT, { locked: true }),
      ["pin"],
      makeRenderCtx({ pin: "GPIO2" })
    );
    expect(findTemplatesByAnchor(result, "<button")).toHaveLength(0);
  });
});

describe("pin wiring input-only guardrail", () => {
  const inputOnlyBoard = () =>
    makeTestBoard({
      pins: [makeBoardPin(2), makeBoardPin(34, { features: ["input", "input_only"] })],
    });

  it("banners and disables the presets the pin can't wire", () => {
    const result = renderPinField(
      wiringPinEntry(PinMode.INPUT),
      ["pin"],
      makeRenderCtx(
        { pin: { number: "GPIO34" } },
        {
          board: inputOnlyBoard(),
          overrides: {
            sectionKey: "binary_sensor.gpio",
            nestedOpenSections: new Set(["pin:pin-advanced"]),
          },
        }
      )
    );
    expect(findTemplatesByAnchor(result, "pin-wiring-banner").length).toBeGreaterThan(0);
    expect(cardById(result, "ground_switch")?.["?disabled"]).toBe(true);
    expect(cardById(result, "vcc_switch")?.["?disabled"]).toBe(true);
    expect(cardById(result, "driven_signal")?.["?disabled"]).toBe(false);
  });

  it("shows no banner on a pin with pulls available", () => {
    const result = renderPinField(
      wiringPinEntry(PinMode.INPUT),
      ["pin"],
      makeRenderCtx(
        { pin: { number: "GPIO2" } },
        {
          board: inputOnlyBoard(),
          overrides: {
            sectionKey: "binary_sensor.gpio",
            nestedOpenSections: new Set(["pin:pin-advanced"]),
          },
        }
      )
    );
    expect(findTemplatesByAnchor(result, "pin-wiring-banner")).toHaveLength(0);
  });
});

describe("pin wiring custom editor", () => {
  const customCtx = (pin: unknown) => openCtx(pin, { getClusterChoice: () => "custom" });

  it("renders direction and pull as exclusive radio groups", () => {
    const result = renderPinField(
      wiringPinEntry(PinMode.INPUT),
      ["pin"],
      customCtx({ number: "GPIO2", mode: { input: true, pullup: true } })
    );
    const groups = findElementBindings(result, "wa-radio-group");
    expect(groups).toHaveLength(2);
    expect(groups[0][".value"]).toBe("input");
    expect(groups[1][".value"]).toBe("pullup");
  });

  it("writes the whole flag object on a pull change, dropping the other pull", () => {
    const ctx = customCtx({ number: "GPIO2", mode: { input: true, pullup: true } });
    const result = renderPinField(wiringPinEntry(PinMode.INPUT), ["pin"], ctx);

    const pullGroup = findElementBindings(result, "wa-radio-group")[1];
    (pullGroup["@change"] as (e: unknown) => void)({
      target: { value: "pulldown" },
    });

    expect(ctx.emitChange).toHaveBeenCalledWith(["pin", "mode"], {
      input: true,
      pulldown: true,
    });
  });

  it("clears both direction flags before writing the new one", () => {
    const ctx = customCtx({
      number: "GPIO2",
      mode: { input: true, output: true, pullup: true },
    });
    const result = renderPinField(wiringPinEntry(PinMode.INPUT), ["pin"], ctx);

    const directionGroup = findElementBindings(result, "wa-radio-group")[0];
    (directionGroup["@change"] as (e: unknown) => void)({
      target: { value: "output" },
    });

    expect(ctx.emitChange).toHaveBeenCalledWith(["pin", "mode"], {
      output: true,
      pullup: true,
    });
  });

  it("falls back to the raw flag list for flags outside the native set", () => {
    const result = renderPinField(
      wiringPinEntry(PinMode.INPUT),
      ["pin"],
      customCtx({ number: "GPIO2", mode: { analog: true } })
    );
    expect(findElementBindings(result, "wa-radio-group")).toHaveLength(0);
  });
});

describe("pin wiring board-preset guard", () => {
  // GPIO2 is locked to this section by a featured component, so its
  // wiring is the board's — edits sit behind the unlock.
  const presetBoard = () =>
    makeTestBoard({
      overrides: {
        featured_components: [
          { component_id: "binary_sensor.gpio", locked_pins: { pin: 2 } },
        ],
      } as never,
    });
  const guardedCtx = (pin: unknown, overrides: Partial<RenderCtx> = {}) =>
    makeRenderCtx(
      { pin },
      {
        board: presetBoard(),
        overrides: {
          sectionKey: "binary_sensor.gpio",
          nestedOpenSections: new Set(["pin:pin-advanced"]),
          ...overrides,
        },
      }
    );

  it("renders the guard row and view-only cards on a board-locked pin", () => {
    const result = renderPinField(
      wiringPinEntry(PinMode.INPUT),
      ["pin"],
      guardedCtx("GPIO2")
    );
    expect(findTemplatesByAnchor(result, "pin-wiring-guard").length).toBeGreaterThan(0);
    expect(cardById(result, "ground_switch")?.["?disabled"]).toBe(true);
    expect(cardById(result, "custom")?.["?disabled"]).toBe(true);
  });

  it("guards a field carrying board suggestions the same way", () => {
    const result = renderPinField(
      wiringPinEntry(PinMode.INPUT, { suggestions: ["GPIO2"] }),
      ["pin"],
      openCtx("GPIO2")
    );
    expect(findTemplatesByAnchor(result, "pin-wiring-guard").length).toBeGreaterThan(0);
    expect(cardById(result, "ground_switch")?.["?disabled"]).toBe(true);
  });

  it("does not guard an ordinary pin", () => {
    const result = renderPinField(
      wiringPinEntry(PinMode.INPUT),
      ["pin"],
      openCtx("GPIO2")
    );
    expect(findTemplatesByAnchor(result, "pin-wiring-guard")).toHaveLength(0);
    expect(cardById(result, "ground_switch")?.["?disabled"]).toBe(false);
  });

  it("opening a guarded short-form pin does not promote it", () => {
    const ctx = guardedCtx("GPIO2", { nestedOpenSections: new Set<string>() });
    const result = renderPinField(wiringPinEntry(PinMode.INPUT), ["pin"], ctx);

    const toggle = findElementBindings(result, "button").find(
      (b) => !("data-preset" in b)
    )!;
    (toggle["@click"] as () => void)();

    expect(ctx.toggleNested).toHaveBeenCalledWith("pin:pin-advanced");
    expect(ctx.emitChange).not.toHaveBeenCalled();
  });

  it("the unlock enables edits and performs the deferred promotion", () => {
    const ctx = guardedCtx("GPIO2");
    const result = renderPinField(wiringPinEntry(PinMode.INPUT), ["pin"], ctx);

    const unlock = findElementBindings(result, "wa-switch")[0];
    (unlock["@change"] as (e: unknown) => void)({ target: { checked: true } });

    expect(ctx.setClusterChoice).toHaveBeenCalledWith("pin:pin-guard", "unlocked");
    expect(ctx.emitChange).toHaveBeenCalledWith(["pin"], { number: "GPIO2" });

    const unlocked = renderPinField(
      wiringPinEntry(PinMode.INPUT),
      ["pin"],
      guardedCtx("GPIO2", {
        getClusterChoice: (key) => (key === "pin:pin-guard" ? "unlocked" : undefined),
      })
    );
    expect(cardById(unlocked, "ground_switch")?.["?disabled"]).toBe(false);
  });
});
