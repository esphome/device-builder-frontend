/**
 * @vitest-environment happy-dom
 *
 * Pins the yaml-updated supersede check and re-base: a disk write
 * computed against a buffer the pane has moved past advances only
 * the saved side, and the removal is re-based onto the live buffer
 * so a later wholesale Save cannot undo the deletion (#1476, #1490).
 * Only when the re-base cannot land does the visibility toast fire.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import "./_mock-device-children.js";

import toast from "sonner-js";

import type { ESPHomeAPI } from "../../src/api/index.js";
import type { AutomationLocation } from "../../src/api/types/automations.js";
import type { YamlUpdatedDetail } from "../../src/components/device/section-editor.js";
import { ESPHomePageDevice } from "../../src/pages/device.js";

/** Narrow typed view of the page internals this suite drives. */
interface BasisView {
  _yaml: string;
  _savedYaml: string;
  _api?: ESPHomeAPI;
  id: string;
  _onYamlUpdated(e: CustomEvent<YamlUpdatedDetail>): void;
}

const makePage = (yaml: string, saved: string): BasisView => {
  const page = new ESPHomePageDevice() as unknown as BasisView;
  page._yaml = yaml;
  page._savedYaml = saved;
  return page;
};

const updated = (page: BasisView, detail: YamlUpdatedDetail) =>
  page._onYamlUpdated(new CustomEvent("yaml-updated", { detail }));

const settle = () => new Promise((r) => setTimeout(r));

beforeEach(() => {
  vi.mocked(toast.info).mockClear();
});

describe("yaml-updated supersede check", () => {
  it("advances both sides when the write's basis is the live buffer", () => {
    const page = makePage("a:\n", "a:\n");

    updated(page, {
      yaml: "b:\n",
      basedOn: "a:\n",
      removed: { kind: "component", sectionKey: "a", fromLine: 0 },
    });

    expect(page._yaml).toBe("b:\n");
    expect(page._savedYaml).toBe("b:\n");
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("re-bases a superseded component-section delete onto the live buffer", async () => {
    // The delete of wifi was computed against the pre-draft buffer;
    // a draft advanced the pane (logger gained a field) meanwhile.
    const page = makePage(
      "wifi:\n  ssid: home\nlogger:\n  level: DEBUG\n",
      "wifi:\n  ssid: home\nlogger:\n"
    );

    updated(page, {
      yaml: "logger:\n",
      basedOn: "wifi:\n  ssid: home\nlogger:\n",
      removed: { kind: "component", sectionKey: "wifi", fromLine: 1 },
    });
    await settle();

    // The live draft keeps its newer edit but loses the deleted
    // section, so Save cannot resurrect it; no toast needed.
    expect(page._yaml).toBe("logger:\n  level: DEBUG\n");
    expect(page._savedYaml).toBe("logger:\n");
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("falls back to saved-only plus toast when the section is unresolvable", async () => {
    // The pane edit already removed the section itself — nothing to
    // re-base, and the conservative branch keeps the pane untouched.
    const page = makePage("logger:\n  level: DEBUG\n", "wifi:\n  ssid: home\nlogger:\n");

    updated(page, {
      yaml: "logger:\n",
      basedOn: "wifi:\n  ssid: home\nlogger:\n",
      removed: { kind: "component", sectionKey: "wifi", fromLine: 1 },
    });
    await settle();

    expect(page._yaml).toBe("logger:\n  level: DEBUG\n");
    expect(page._savedYaml).toBe("logger:\n");
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  it("re-bases an automation delete through a fresh diff against the live buffer", async () => {
    const page = makePage(
      "logger:\n  level: DEBUG\nscript:\n  - id: s1\n",
      "logger:\nscript:\n  - id: s1\n"
    );
    page.id = "device.yaml";
    const deleteAutomation = vi
      .fn()
      .mockResolvedValue({ yaml_diff: { fromLine: 3, toLine: 4, replacement: "" } });
    page._api = { deleteAutomation } as unknown as ESPHomeAPI;
    const location: AutomationLocation = { kind: "script", id: "s1" };

    updated(page, {
      yaml: "logger:\n",
      basedOn: "logger:\nscript:\n  - id: s1\n",
      removed: { kind: "automation", location },
    });
    await settle();

    // The recompute ran against the live buffer, not the basis.
    expect(deleteAutomation).toHaveBeenCalledWith(
      "device.yaml",
      location,
      "logger:\n  level: DEBUG\nscript:\n  - id: s1\n"
    );
    expect(page._yaml).toBe("logger:\n  level: DEBUG\n");
    expect(page._savedYaml).toBe("logger:\n");
    expect(toast.info).not.toHaveBeenCalled();
  });
});
