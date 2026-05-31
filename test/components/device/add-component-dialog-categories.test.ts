import { describe, expect, it } from "vitest";
import { CORE_CATEGORIES } from "../../../src/api/types/components.js";
import { chooseExcludeCategories } from "../../../src/components/device/add-component-dialog-categories.js";

describe("chooseExcludeCategories", () => {
  it("hides core / ota / update from a regular browse", () => {
    // Default state of the "Add component" dialog: the user is
    // looking for a sensor / output / etc. The dedicated
    // "Add core configuration" entry point handles core / ota /
    // update separately, so those are filtered out of this
    // browse to keep the catalog focused.
    const result = chooseExcludeCategories({
      isCoreLocked: false,
      isInDepDetour: false,
    });
    expect(result).toEqual(CORE_CATEGORIES);
  });

  it("excludes nothing when the dialog is locked to core categories", () => {
    // The "Add core configuration" dialog locks IN core / ota /
    // update via ``lockedCategories``. Excluding the same set
    // would leave the catalog with zero results.
    const result = chooseExcludeCategories({
      isCoreLocked: true,
      isInDepDetour: false,
    });
    expect(result).toEqual([]);
  });

  it("excludes nothing in dep-detour mode (regression for #383)", () => {
    // The form's missing-deps banner forwards the user to the
    // catalog filtered to the missing dep's domain. That dep is
    // sometimes a core block — e.g. ``sensor.debug`` needs the
    // bare ``debug:`` block whose catalog entry is
    // ``core.debug``. Hiding it from the very search the form
    // drove the user to is the foot-gun this exception fixes.
    // A regression that re-narrows the condition (e.g. drops
    // the ``isInDepDetour`` term) would put the user back in
    // "the dep can't be added from here" and fail this test.
    const result = chooseExcludeCategories({
      isCoreLocked: false,
      isInDepDetour: true,
    });
    expect(result).toEqual([]);
  });

  it("treats core-locked + dep-detour as a single 'show everything' state", () => {
    // Defensive case: if both flags somehow flip true at once,
    // the result is still ``[]``. Pinned to lock in the
    // monotonic shape — adding either flag is a one-way
    // transition from CORE_CATEGORIES to ``[]``, never the
    // reverse.
    const result = chooseExcludeCategories({
      isCoreLocked: true,
      isInDepDetour: true,
    });
    expect(result).toEqual([]);
  });
});
