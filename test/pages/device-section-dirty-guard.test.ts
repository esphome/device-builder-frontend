/**
 * @vitest-environment happy-dom
 *
 * Pins the dirty-change identity guard: only the active section may
 * flip the page's section-dirty flag, so a flip from a stale or
 * already-unmounted emitter cannot disarm (or arm) the unsaved
 * changes guard against the wrong section, and a flip landing in the
 * no-active-section window is recovered by the next mount (#1486).
 */
import { describe, expect, it } from "vitest";

import "./_mock-device-children.js";

import type { SectionEditor } from "../../src/components/device/section-editor.js";
import { ESPHomePageDevice } from "../../src/pages/device.js";

/** Narrow typed view of the page internals this suite drives. */
interface DirtyGuardView {
  _activeSection: SectionEditor | null;
  _sectionDirty: boolean;
  _onSectionDirtyChange(e: CustomEvent<{ dirty: boolean; node: SectionEditor }>): void;
  _onSectionMount(e: CustomEvent<{ node: SectionEditor }>): void;
}

const view = (page: ESPHomePageDevice) => page as unknown as DirtyGuardView;

const editor = (dirty = false): SectionEditor => ({
  dirty,
  lastFlushFailed: false,
  flushPending: () => {},
  reload: () => {},
});

describe("dirty-change identity guard", () => {
  it("applies the active section's flip and ignores a stale emitter's", () => {
    const page = view(new ESPHomePageDevice());
    const active = editor();
    const stale = editor();
    page._activeSection = active;
    page._sectionDirty = false;

    page._onSectionDirtyChange(
      new CustomEvent("dirty-change", { detail: { dirty: true, node: active } })
    );
    expect(page._sectionDirty).toBe(true);

    // A previous editor's in-flight upsert settles late and reports
    // clean — it must not disarm the active section's dirty state.
    page._onSectionDirtyChange(
      new CustomEvent("dirty-change", { detail: { dirty: false, node: stale } })
    );
    expect(page._sectionDirty).toBe(true);
  });

  it("drops a flip in the no-active window; the next mount re-syncs", () => {
    const page = view(new ESPHomePageDevice());
    const late = editor(true);
    page._activeSection = null;
    page._sectionDirty = false;

    // Between section-unmount and the next section-mount there is no
    // active section to speak for — the flip is dropped…
    page._onSectionDirtyChange(
      new CustomEvent("dirty-change", { detail: { dirty: true, node: late } })
    );
    expect(page._sectionDirty).toBe(false);

    // …and the mount re-syncs from the editor's own dirty state.
    page._onSectionMount(new CustomEvent("section-mount", { detail: { node: late } }));
    expect(page._sectionDirty).toBe(true);
  });
});
