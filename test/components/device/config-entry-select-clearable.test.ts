import { describe, expect, it } from "vitest";
import type { ConfigValueOption } from "../../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import {
  renderSelectField,
  selectOptions,
} from "../../../src/components/device/config-entry-renderers/primitives.js";
import { findElementBindings, makeEntry, makeRenderCtx } from "./_renderer-fixtures.js";

// The backend ships an empty-value "(none)" option for optional enums,
// alphabetically mid-list (e.g. between `duration` and `energy` in
// device_class). We surface a clear (×) and drop the pseudo-option.
const OPTIONAL: ConfigValueOption[] = [
  { value: "energy", label: "energy" },
  { value: "", label: "(none)" },
  { value: "power", label: "power" },
];

const REQUIRED: ConfigValueOption[] = [
  { value: "a", label: "a" },
  { value: "b", label: "b" },
];

function selectFor(options: ConfigValueOption[], value: string) {
  const entry = makeEntry(ConfigEntryType.SELECT, { options });
  return renderSelectField(
    entry,
    ["device_class"],
    makeRenderCtx({ device_class: value })
  );
}

describe("selectOptions", () => {
  it("flags an empty-value option as clearable and filters it out", () => {
    const entry = makeEntry(ConfigEntryType.SELECT, { options: OPTIONAL });
    expect(selectOptions(entry)).toEqual({
      clearable: true,
      visibleOptions: [
        { value: "energy", label: "energy" },
        { value: "power", label: "power" },
      ],
    });
  });

  it("a required enum is not clearable and keeps every option", () => {
    const entry = makeEntry(ConfigEntryType.SELECT, { options: REQUIRED });
    expect(selectOptions(entry)).toEqual({ clearable: false, visibleOptions: REQUIRED });
  });

  it("memoizes the derivation per entry", () => {
    const entry = makeEntry(ConfigEntryType.SELECT, { options: OPTIONAL });
    expect(selectOptions(entry)).toBe(selectOptions(entry));
  });
});

describe("renderSelectField — optional enum", () => {
  it("makes the select clearable and renders no (none) option", () => {
    const tpl = selectFor(OPTIONAL, "energy");
    expect(findElementBindings(tpl, "wa-select")[0][".withClear"]).toBe(true);
    const values = findElementBindings(tpl, "wa-option").map((b) => b.value);
    expect(values).toEqual(["energy", "power"]);
  });

  it("leaves a required enum non-clearable with all options", () => {
    const tpl = selectFor(REQUIRED, "a");
    expect(findElementBindings(tpl, "wa-select")[0][".withClear"]).toBe(false);
    expect(findElementBindings(tpl, "wa-option").map((b) => b.value)).toEqual(["a", "b"]);
  });
});
