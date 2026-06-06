/**
 * renderExclusiveGroupField renders mutually-exclusive sibling entries
 * (backend exclusive_group, e.g. a remote_receiver binary_sensor's
 * protocols) as one pick-one dropdown. The selected member is the one
 * present in the values; switching clears the others so exactly one key
 * survives.
 */
import { describe, expect, it, vi } from "vitest";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { renderExclusiveGroupField } from "../../../src/components/device/config-entry-renderers.js";
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

  it("defaults to the placeholder when nothing is set", () => {
    const ctx = makeRenderCtx({});
    const tpl = renderExclusiveGroupField(members(), ctx);

    expect(selectedValues(tpl)).toEqual([""]);
  });
});
