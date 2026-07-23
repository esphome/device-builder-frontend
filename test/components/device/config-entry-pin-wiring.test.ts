/**
 * Template-shape tests for the pin wiring preset UI, driven through
 * ``renderPinField`` like the other pin renderer suites. Cards are
 * looked up by their ``data-preset`` binding; walker and fixtures are
 * shared with the sibling tests.
 */
import { describe, expect, it, vi } from "vitest";
import { ConfigEntryType, PinMode } from "../../../src/api/types/config-entries.js";
import type { ConfigEntry } from "../../../src/api/types/config-entries.js";
import { renderPinField } from "../../../src/components/device/config-entry-pin-renderer.js";
import type { RenderCtx } from "../../../src/components/device/config-entry-renderers-shared.js";
import {
  extractAttributeBindings,
  findTemplatesByAnchor,
} from "../../_lit-template-walker.js";
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

const openCtx = (
  pin: unknown,
  overrides: Partial<RenderCtx> = {},
  board?: ReturnType<typeof makeTestBoard>
) =>
  makeRenderCtx(
    { pin },
    {
      ...(board !== undefined ? { board } : {}),
      overrides: {
        sectionKey: "binary_sensor.gpio",
        nestedOpenSections: new Set(["pin:pin-advanced"]),
        ...overrides,
      },
    }
  );

/** Card bindings, including the Custom card's static ``data-preset``
 *  attribute (the preset cards carry it as a binding). */
const cards = (result: unknown) =>
  findTemplatesByAnchor(result, "<button")
    .map((t) => {
      const bindings = extractAttributeBindings(t);
      if (!("data-preset" in bindings)) {
        const strings = (t as { strings?: readonly string[] }).strings;
        const m = /data-preset="([^"]+)"/.exec(strings?.join("") ?? "");
        if (m) bindings["data-preset"] = m[1];
      }
      return bindings;
    })
    .filter((b) => "data-preset" in b);
const cardById = (result: unknown, id: string) =>
  cards(result).find((b) => b["data-preset"] === id);
const disclosureToggle = (result: unknown) =>
  findElementBindings(result, "button").find((b) => "aria-expanded" in b)!;

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
    expect(cardById(result, "ground_switch")?.["aria-disabled"]).toBe("true");
    expect(cardById(result, "vcc_switch")?.["aria-disabled"]).toBe("true");
    expect(cardById(result, "driven_signal")?.["aria-disabled"]).toBe("false");
  });

  it("moves the tab stop off a disabled selected card", () => {
    // Stored flags match ground_switch, but the input-only pin disables
    // it; the tab stop must land on a focusable card or the radiogroup
    // is unreachable by keyboard.
    const result = renderPinField(
      wiringPinEntry(PinMode.INPUT),
      ["pin"],
      makeRenderCtx(
        { pin: { number: "GPIO34", mode: { input: true, pullup: true } } },
        {
          board: inputOnlyBoard(),
          overrides: {
            sectionKey: "binary_sensor.gpio",
            nestedOpenSections: new Set(["pin:pin-advanced"]),
          },
        }
      )
    );
    expect(cardById(result, "ground_switch")?.tabindex).toBe("-1");
    expect(cardById(result, "driven_signal")?.tabindex).toBe("0");
  });

  it("makes Custom the tab stop when every preset is disabled", () => {
    const result = renderPinField(
      wiringPinEntry(PinMode.OUTPUT),
      ["pin"],
      makeRenderCtx(
        { pin: { number: "GPIO34" } },
        {
          board: inputOnlyBoard(),
          overrides: {
            sectionKey: "switch.gpio",
            nestedOpenSections: new Set(["pin:pin-advanced"]),
          },
        }
      )
    );
    expect(cardById(result, "output_standard")?.tabindex).toBe("-1");
    expect(cardById(result, "custom")?.tabindex).toBe("0");
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

  it("drops the mode key instead of writing an empty mapping", () => {
    const ctx = customCtx({ number: "GPIO2", mode: { pullup: true } });
    const result = renderPinField(wiringPinEntry(PinMode.INPUT), ["pin"], ctx);

    const pullGroup = findElementBindings(result, "wa-radio-group")[1];
    (pullGroup["@change"] as (e: unknown) => void)({ target: { value: "none" } });

    expect(ctx.emitChange).toHaveBeenCalledWith(["pin", "mode"], undefined);
  });

  it("disables the options an input-only pin can't do, except the set one", () => {
    const board = makeTestBoard({
      pins: [makeBoardPin(34, { features: ["input", "input_only"] })],
    });
    // Legacy config already carries pullup on GPIO34: the option stays
    // enabled so the user can move off it, but pulldown and the output
    // directions are out.
    const result = renderPinField(
      wiringPinEntry(PinMode.INPUT),
      ["pin"],
      openCtx(
        { number: "GPIO34", mode: { input: true, pullup: true } },
        { getClusterChoice: () => "custom" },
        board
      )
    );

    const radios = findElementBindings(result, "wa-radio");
    const byValue = (v: string) => radios.find((r) => r.value === v);
    expect(byValue("output")?.["?disabled"]).toBe(true);
    expect(byValue("both")?.["?disabled"]).toBe(true);
    expect(byValue("input")?.["?disabled"]).toBe(false);
    expect(byValue("pullup")?.["?disabled"]).toBe(false);
    expect(byValue("pulldown")?.["?disabled"]).toBe(true);
    expect(byValue("none")?.["?disabled"]).toBe(false);
  });
});

describe("pin wiring input-only banner copy", () => {
  it("uses the output variant on an output field", () => {
    const localize = vi.fn((key: string) => key);
    renderPinField(
      wiringPinEntry(PinMode.OUTPUT),
      ["pin"],
      makeRenderCtx(
        { pin: { number: "GPIO34" } },
        {
          board: makeTestBoard({
            pins: [makeBoardPin(34, { features: ["input", "input_only"] })],
          }),
          overrides: {
            sectionKey: "switch.gpio",
            nestedOpenSections: new Set(["pin:pin-advanced"]),
            localize: localize as never,
          },
        }
      )
    );
    expect(localize).toHaveBeenCalledWith("device.pin_wiring_input_only_banner_output", {
      pin: "GPIO34",
    });
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
    openCtx(pin, overrides, presetBoard());

  it("renders the guard row and view-only cards on a board-locked pin", () => {
    const result = renderPinField(
      wiringPinEntry(PinMode.INPUT),
      ["pin"],
      guardedCtx("GPIO2")
    );
    expect(findTemplatesByAnchor(result, "pin-wiring-guard").length).toBeGreaterThan(0);
    expect(cardById(result, "ground_switch")?.["aria-disabled"]).toBe("true");
    expect(cardById(result, "custom")?.["aria-disabled"]).toBe("true");
    // Hovering the greyed cards explains the unlock.
    expect(cardById(result, "ground_switch")?.title).toBe(
      "device.pin_wiring_guard_tooltip"
    );
  });

  it("guards a pin sitting on a featured-component field preset", () => {
    // The board pre-fills the pin without locking it (the ESK-1 RGB
    // header); the guard still arms.
    const result = renderPinField(
      wiringPinEntry(PinMode.INPUT),
      ["pin"],
      openCtx(
        { number: "GPIO2" },
        {},
        makeTestBoard({
          overrides: {
            featured_components: [
              { component_id: "binary_sensor.gpio", fields: { pin: { value: 2 } } },
            ],
          } as never,
        })
      )
    );
    expect(findTemplatesByAnchor(result, "pin-wiring-guard").length).toBeGreaterThan(0);
    expect(cardById(result, "ground_switch")?.["aria-disabled"]).toBe("true");
  });

  it("guards a field carrying board suggestions the same way", () => {
    const result = renderPinField(
      wiringPinEntry(PinMode.INPUT, { suggestions: ["GPIO2"] }),
      ["pin"],
      openCtx("GPIO2")
    );
    expect(findTemplatesByAnchor(result, "pin-wiring-guard").length).toBeGreaterThan(0);
    expect(cardById(result, "ground_switch")?.["aria-disabled"]).toBe("true");
  });

  it("does not guard an ordinary pin", () => {
    const result = renderPinField(
      wiringPinEntry(PinMode.INPUT),
      ["pin"],
      openCtx("GPIO2")
    );
    expect(findTemplatesByAnchor(result, "pin-wiring-guard")).toHaveLength(0);
    expect(cardById(result, "ground_switch")?.["aria-disabled"]).toBe("false");
  });

  it("opening a guarded short-form pin does not promote it", () => {
    const ctx = guardedCtx("GPIO2", { nestedOpenSections: new Set<string>() });
    const result = renderPinField(wiringPinEntry(PinMode.INPUT), ["pin"], ctx);

    (disclosureToggle(result)["@click"] as () => void)();

    expect(ctx.toggleNested).toHaveBeenCalledWith("pin:pin-advanced");
    expect(ctx.emitChange).not.toHaveBeenCalled();
  });

  it("does not guard a pin moved off the board's suggestions", () => {
    const result = renderPinField(
      wiringPinEntry(PinMode.INPUT, { suggestions: ["GPIO2"] }),
      ["pin"],
      openCtx("GPIO33")
    );
    expect(findTemplatesByAnchor(result, "pin-wiring-guard")).toHaveLength(0);
    expect(cardById(result, "ground_switch")?.["aria-disabled"]).toBe("false");
  });

  it("locks children routed through the form dispatch while guarded", () => {
    // ``ctx.renderEntry`` closes over the form's original ctx, so the
    // guard must lock the entries themselves; a disabled ctx copy alone
    // fails open on the raw-disclosure path.
    const ctx = openCtx(
      { number: "GPIO2", mode: {} },
      { sectionKey: "light.esp32_rmt_led_strip" }
    );
    renderPinField(
      wiringPinEntry(PinMode.OUTPUT, { suggestions: ["GPIO2"] }),
      ["pin"],
      ctx
    );

    expect(ctx.renderEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "mode",
        locked: true,
        config_entries: expect.arrayContaining([
          expect.objectContaining({ key: "pullup", locked: true }),
        ]),
      }),
      ["pin", "mode"]
    );
  });

  it("keeps non-wiring advanced extras behind the global toggle", () => {
    // The force-include is scoped to mode + inverted; the validation
    // escape hatches stay gated.
    const escapeHatch = makeEntry(ConfigEntryType.BOOLEAN, {
      key: "ignore_strapping_warning",
      label: "Ignore strapping warning",
      advanced: true,
    });
    const entry = wiringPinEntry(PinMode.INPUT, {
      config_entries: [modeChild(), invertedChild(), escapeHatch],
    });
    const gated = (entries: ConfigEntry[]) => entries.filter((c) => !c.advanced);
    const ctx = openCtx({ number: "GPIO2" }, { filterRenderable: gated });
    renderPinField(entry, ["pin"], ctx);
    expect(ctx.renderEntry).not.toHaveBeenCalledWith(
      expect.objectContaining({ key: "ignore_strapping_warning" }),
      expect.anything()
    );

    const openCtxAdvanced = openCtx({ number: "GPIO2" });
    renderPinField(entry, ["pin"], openCtxAdvanced);
    expect(openCtxAdvanced.renderEntry).toHaveBeenCalledWith(
      expect.objectContaining({ key: "ignore_strapping_warning" }),
      ["pin", "ignore_strapping_warning"]
    );
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
    expect(cardById(unlocked, "ground_switch")?.["aria-disabled"]).toBe("false");
  });
});
