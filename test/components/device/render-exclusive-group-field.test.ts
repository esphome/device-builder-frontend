/**
 * renderExclusiveGroupField renders mutually-exclusive sibling entries
 * (backend exclusive_group, e.g. a remote_receiver binary_sensor's
 * protocols) as one pick-one dropdown. The selected member is the one
 * present in the values; switching clears the others so exactly one key
 * survives.
 */
import { describe, expect, it, vi } from "vitest";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import {
  orderExclusiveGroups,
  renderExclusiveGroupField,
} from "../../../src/components/device/config-entry-renderers.js";
import { findTemplatesByAnchor } from "../../_lit-template-walker.js";
import { findElementBindings, makeEntry, makeRenderCtx } from "./_renderer-fixtures.js";

function members() {
  return [
    makeEntry(ConfigEntryType.NESTED, {
      key: "raw",
      exclusive_group: "g",
      config_entries: [makeEntry(ConfigEntryType.STRING, { key: "code" })],
    }),
    makeEntry(ConfigEntryType.NESTED, {
      key: "nec",
      exclusive_group: "g",
      config_entries: [makeEntry(ConfigEntryType.INTEGER, { key: "address" })],
    }),
  ];
}

const selectedValues = (tpl: unknown) =>
  findElementBindings(tpl, "wa-option")
    .filter((o) => o["?selected"])
    .map((o) => o.value);

describe("renderExclusiveGroupField", () => {
  it("selects the member present in the values and renders its children", () => {
    const renderEntry = vi.fn();
    const ctx = makeRenderCtx({ raw: { code: "x" } }, { overrides: { renderEntry } });
    const tpl = renderExclusiveGroupField(members(), ctx);

    expect(selectedValues(tpl)).toEqual(["raw"]);
    expect(renderEntry).toHaveBeenCalledWith(expect.objectContaining({ key: "code" }), [
      "raw",
      "code",
    ]);
  });

  it("switching clears the other members and scaffolds the chosen key", () => {
    const emitChange = vi.fn();
    const ctx = makeRenderCtx({ raw: { code: "x" } }, { overrides: { emitChange } });
    const tpl = renderExclusiveGroupField(members(), ctx);

    const onChange = findElementBindings(tpl, "wa-select")[0]["@change"] as (
      e: Event
    ) => void;
    onChange({ target: { value: "nec" } } as never);

    expect(emitChange).toHaveBeenCalledWith(["raw"], undefined);
    expect(emitChange).toHaveBeenCalledWith(["nec"], {});
  });

  it("clears only members that are present", () => {
    // Switching must not emit undefined for absent members (avoids ~N
    // redundant events and stray key: undefined state).
    const emitChange = vi.fn();
    const ms = [
      ...members(),
      makeEntry(ConfigEntryType.NESTED, { key: "jvc", exclusive_group: "g" }),
    ];
    const ctx = makeRenderCtx({ raw: { code: "x" } }, { overrides: { emitChange } });
    const onChange = findElementBindings(
      renderExclusiveGroupField(ms, ctx),
      "wa-select"
    )[0]["@change"] as (e: Event) => void;
    onChange({ target: { value: "jvc" } } as never);

    expect(emitChange).toHaveBeenCalledWith(["raw"], undefined); // present → cleared
    expect(emitChange).not.toHaveBeenCalledWith(["nec"], undefined); // absent → untouched
    expect(emitChange).toHaveBeenCalledWith(["jvc"], {}); // chosen → scaffolded
  });

  it("disables the dropdown when every member is board-locked", () => {
    const ctx = makeRenderCtx({ raw: { code: "x" } });
    const locked = members().map((m) => ({ ...m, locked: true }));
    const tpl = renderExclusiveGroupField(locked, ctx);
    expect(findElementBindings(tpl, "wa-select")[0]["?disabled"]).toBe(true);
  });

  it("keeps the dropdown enabled when a member is still unlocked", () => {
    const ctx = makeRenderCtx({ raw: { code: "x" } });
    const [a, b] = members();
    const tpl = renderExclusiveGroupField([{ ...a, locked: true }, b], ctx);
    expect(findElementBindings(tpl, "wa-select")[0]["?disabled"]).toBe(false);
  });

  it("disables when every visible option is locked, ignoring a hidden unlocked member", () => {
    // The unlocked member is platform-incompatible (hidden), so it isn't a
    // selectable option; the dropdown should still be read-only.
    const ms = [
      makeEntry(ConfigEntryType.NESTED, {
        key: "raw",
        exclusive_group: "g",
        locked: true,
      }),
      makeEntry(ConfigEntryType.NESTED, {
        key: "esp8266only",
        exclusive_group: "g",
        supported_platforms: ["esp8266"],
      }),
    ];
    const tpl = renderExclusiveGroupField(ms, makeRenderCtx({}));
    expect(findElementBindings(tpl, "wa-select")[0]["?disabled"]).toBe(true);
  });

  it("preserves an existing member's values when switching to it", () => {
    // Conflict case (both set): picking the one to keep must clear only the
    // others, never overwrite the chosen member's config with {}.
    const emitChange = vi.fn();
    const ctx = makeRenderCtx(
      { raw: { code: "x" }, nec: { address: 1 } },
      { overrides: { emitChange } }
    );
    const tpl = renderExclusiveGroupField(members(), ctx);

    const onChange = findElementBindings(tpl, "wa-select")[0]["@change"] as (
      e: Event
    ) => void;
    onChange({ target: { value: "raw" } } as never);

    expect(emitChange).toHaveBeenCalledWith(["nec"], undefined);
    expect(emitChange).not.toHaveBeenCalledWith(["raw"], {});
  });

  it("sets the wrapper data-field-key to the selected member", () => {
    // Focus/scroll sync needs the group's wrapper to carry the chosen
    // protocol's path, not always the first member's.
    const ctx = makeRenderCtx({ nec: {} });
    const div = findElementBindings(renderExclusiveGroupField(members(), ctx), "div")[0];
    expect(div["data-field-key"]).toBe(JSON.stringify(["nec"]));
  });

  it("uses an empty data-field-key when nothing is selected", () => {
    const ctx = makeRenderCtx({});
    const div = findElementBindings(renderExclusiveGroupField(members(), ctx), "div")[0];
    expect(div["data-field-key"]).toBe(JSON.stringify([]));
  });

  it("hides a platform-incompatible member from the options", () => {
    // Board defaults to esp32; an esp8266-only protocol must not be offered.
    const ms = [
      ...members(),
      makeEntry(ConfigEntryType.NESTED, {
        key: "esp8266only",
        exclusive_group: "g",
        supported_platforms: ["esp8266"],
      }),
    ];
    const opts = findElementBindings(
      renderExclusiveGroupField(ms, makeRenderCtx({})),
      "wa-option"
    ).map((o) => o.value);
    expect(opts).toContain("raw");
    expect(opts).not.toContain("esp8266only");
  });

  it("keeps an incompatible member selectable when it's already set", () => {
    const ms = [
      ...members(),
      makeEntry(ConfigEntryType.NESTED, {
        key: "esp8266only",
        exclusive_group: "g",
        supported_platforms: ["esp8266"],
      }),
    ];
    const opts = findElementBindings(
      renderExclusiveGroupField(ms, makeRenderCtx({ esp8266only: {} })),
      "wa-option"
    ).map((o) => o.value);
    expect(opts).toContain("esp8266only");
  });

  it("associates the select with its label via aria-labelledby", () => {
    const tpl = renderExclusiveGroupField(members(), makeRenderCtx({}));
    const select = findElementBindings(tpl, "wa-select")[0];
    const label = findElementBindings(tpl, "label")[0];
    expect(typeof label["id"]).toBe("string");
    expect(select["aria-labelledby"]).toBe(label["id"]);
  });

  it("treats an explicit null member as present", () => {
    // A hand-written ``raw:`` parses to null; the key exists, so the
    // protocol is selected (only undefined means cleared/absent).
    const ctx = makeRenderCtx({ raw: null });
    expect(selectedValues(renderExclusiveGroupField(members(), ctx))).toEqual(["raw"]);
  });

  it("keeps a freshly-scaffolded member selected", () => {
    // onChange writes {} for the picked member; it must stay selected even
    // though it has no serializable content yet (else the dropdown snaps
    // back to the placeholder and hides its fields).
    const ctx = makeRenderCtx({ nec: {} });
    expect(selectedValues(renderExclusiveGroupField(members(), ctx))).toEqual(["nec"]);
  });

  it("ignores a cleared member left as undefined", () => {
    const ctx = makeRenderCtx({ nec: {}, raw: undefined });
    expect(selectedValues(renderExclusiveGroupField(members(), ctx))).toEqual(["nec"]);
  });

  it("warns when more than one member is set", () => {
    const ctx = makeRenderCtx({ raw: { code: "x" }, nec: { address: 1 } });
    const tpl = renderExclusiveGroupField(members(), ctx);
    const note = findTemplatesByAnchor(tpl, "exclusive-group-conflict");
    expect(note.length).toBe(1);
  });

  it("defaults to the placeholder (non-empty sentinel) when nothing is set", () => {
    // The placeholder uses a sentinel value, not "", so the form's
    // _syncSelectedAttr (which no-ops on empty) still drives the select to it.
    const ctx = makeRenderCtx({});
    const tpl = renderExclusiveGroupField(members(), ctx);

    expect(selectedValues(tpl)).toEqual(["__none__"]);
  });
});

describe("orderExclusiveGroups", () => {
  it("collapses a group to its first member's position", () => {
    const entries = [
      makeEntry(ConfigEntryType.STRING, { key: "name" }),
      makeEntry(ConfigEntryType.NESTED, { key: "raw", exclusive_group: "g" }),
      makeEntry(ConfigEntryType.STRING, { key: "id" }),
      makeEntry(ConfigEntryType.NESTED, { key: "nec", exclusive_group: "g" }),
    ];
    const ordered = orderExclusiveGroups(entries);
    // name, [raw, nec] (at raw's slot), id — the second member is folded in.
    expect(ordered.map((i) => (Array.isArray(i) ? i.map((m) => m.key) : i.key))).toEqual([
      "name",
      ["raw", "nec"],
      "id",
    ]);
  });
});
