/**
 * @vitest-environment happy-dom
 *
 * Pins the yaml-draft guards (#1479): a draft announced for a
 * different device is dropped silently; a late anchored draft whose
 * basis the pane moved past is dropped visibly; the active section's
 * drafts apply even when their basis lags the buffer by a render.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import "./_mock-device-children.js";

import toast from "sonner-js";

import type {
  SectionEditor,
  YamlDraftDetail,
} from "../../src/components/device/section-editor.js";
import { ESPHomePageDevice } from "../../src/pages/device.js";

interface DraftView {
  _yaml: string;
  id: string;
  _activeSection: SectionEditor | null;
  _onYamlDraft(e: CustomEvent<YamlDraftDetail>): void;
}

const makePage = (yaml: string): DraftView => {
  const page = new ESPHomePageDevice() as unknown as DraftView;
  page.id = "device.yaml";
  page._yaml = yaml;
  return page;
};

const draft = (page: DraftView, detail: YamlDraftDetail) =>
  page._onYamlDraft(new CustomEvent("yaml-draft", { detail }));

beforeEach(() => {
  vi.mocked(toast.info).mockClear();
});

describe("yaml-draft guards", () => {
  it("applies a draft announced for this device against the live basis", () => {
    const page = makePage("a:\n");

    draft(page, {
      configuration: "device.yaml",
      yaml: "a:\n  x: 1\n",
      basedOn: "a:\n",
      node: new EventTarget(),
    });

    expect(page._yaml).toBe("a:\n  x: 1\n");
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("drops a draft announced for a different device", () => {
    const page = makePage("b-config:\n");

    // The router reuses the page element across devices; a late
    // upsert echo from the previous device must not splice here.
    draft(page, {
      configuration: "other.yaml",
      yaml: "a:\n  x: 1\n",
      basedOn: "a:\n",
      node: new EventTarget(),
    });

    expect(page._yaml).toBe("b-config:\n");
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("applies the active section's draft even when its basis lags", () => {
    const page = makePage("a:\n  x: 1\n");
    const active = new EventTarget() as unknown as SectionEditor;
    page._activeSection = active;

    // Rapid consecutive splices: the editor's yaml prop lags its own
    // last draft by a render, so the basis is legitimately stale.
    draft(page, {
      configuration: "device.yaml",
      yaml: "a:\n  x: 2\n",
      basedOn: "a:\n",
      node: active as unknown as EventTarget,
    });

    expect(page._yaml).toBe("a:\n  x: 2\n");
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("drops a late anchored draft whose basis the pane moved past", () => {
    const page = makePage("newer:\n");

    // The emitting editor already unmounted (it is not the active
    // section) and the buffer moved on — landing the draft would
    // clobber the newer edit.
    draft(page, {
      configuration: "device.yaml",
      yaml: "old-splice:\n",
      basedOn: "old:\n",
      node: new EventTarget(),
    });

    expect(page._yaml).toBe("newer:\n");
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  it("applies a late anchored draft whose basis still matches", () => {
    const page = makePage("a:\n");

    // Unmounted emitter, but the pane never moved: the draft is the
    // freshest state and must not be lost.
    draft(page, {
      configuration: "device.yaml",
      yaml: "a:\n  x: 1\n",
      basedOn: "a:\n",
      node: new EventTarget(),
    });

    expect(page._yaml).toBe("a:\n  x: 1\n");
    expect(toast.info).not.toHaveBeenCalled();
  });
});
