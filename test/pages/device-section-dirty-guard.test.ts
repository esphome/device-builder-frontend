/**
 * @vitest-environment happy-dom
 *
 * Pins the dirty-change identity guard: only the active section may
 * flip the page's section-dirty flag, so a late settle from a
 * previous editor cannot disarm (or arm) the unsaved-changes guard
 * against the wrong section (#1486).
 */
import { describe, expect, it } from "vitest";

import "./_mock-device-children.js";

import { ESPHomePageDevice } from "../../src/pages/device.js";
import type { SectionEditor } from "../../src/components/device/section-editor.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internals = (page: ESPHomePageDevice) => page as any;

const editor = (): SectionEditor => ({
  dirty: false,
  flushPending: () => {},
  reload: () => {},
});

describe("dirty-change identity guard", () => {
  it("applies the active section's flip and ignores a stale emitter's", () => {
    const page = new ESPHomePageDevice();
    const active = editor();
    const stale = editor();
    internals(page)._activeSection = active;
    internals(page)._sectionDirty = false;

    internals(page)._onSectionDirtyChange(
      new CustomEvent("dirty-change", { detail: { dirty: true, node: active } })
    );
    expect(internals(page)._sectionDirty).toBe(true);

    // A previous editor's in-flight upsert settles late and reports
    // clean — it must not disarm the active section's dirty state.
    internals(page)._onSectionDirtyChange(
      new CustomEvent("dirty-change", { detail: { dirty: false, node: stale } })
    );
    expect(internals(page)._sectionDirty).toBe(true);
  });
});
