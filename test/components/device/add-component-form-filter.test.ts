import { describe, expect, it } from "vitest";
import { addFormNeedsUserInput } from "../../../src/components/device/add-component-form-filter.js";
import { makeConfigEntry } from "../../util/_make-config-entry.js";

const NONE = new Set<string>();

describe("addFormNeedsUserInput", () => {
  it("is false when every visible field is board-locked (a dead-end form)", () => {
    // A featured component whose every field is pinned by the board: the form
    // would render only read-only "Set by the board" rows, so it should be
    // skipped and the component added straight away.
    const entries = [
      makeConfigEntry({ key: "pin", required: true, locked: true }),
      makeConfigEntry({ key: "type", required: true, locked: true }),
    ];
    expect(addFormNeedsUserInput(entries, {}, [], null, NONE)).toBe(false);
  });

  it("is true when any visible field is unlocked", () => {
    const entries = [
      makeConfigEntry({ key: "pin", required: true, locked: true }),
      makeConfigEntry({ key: "name", required: true, locked: false }),
    ];
    expect(addFormNeedsUserInput(entries, {}, [], null, NONE)).toBe(true);
  });
});
