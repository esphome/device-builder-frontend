/**
 * @vitest-environment happy-dom
 *
 * Contract test for the shared post-upsert dispatch used by the
 * add-automation and add-script wizard dialogs. The device page
 * listens for these events by name and detail shape, so the wire
 * names, detail keys, bubbling/composed flags, and the
 * yaml-draft-before-automation-added ordering are all pinned here.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { YamlDiff } from "../../../src/api/types/automations.js";
import { applyYamlDiff } from "../../../src/components/device/automation-editor/serialise.js";
import { dispatchAutomationAdded } from "../../../src/components/device/dispatch-automation-added.js";

const YAML = "esphome:\n  name: test";

/** Insert-shaped diff (toLine == fromLine - 1) appending a script block. */
const DIFF: YamlDiff = {
  fromLine: 3,
  toLine: 2,
  replacement: "script:\n  - id: my_script\n",
};

function mountHost(): { parent: HTMLElement; host: HTMLElement } {
  const parent = document.createElement("div");
  const host = document.createElement("div");
  parent.appendChild(host);
  document.body.appendChild(parent);
  return { parent, host };
}

describe("dispatchAutomationAdded", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("dispatches yaml-draft with the spliced yaml, then automation-added with the section key", () => {
    const { parent, host } = mountHost();
    const seen: { type: string; detail: unknown; composed: boolean }[] = [];
    for (const type of ["yaml-draft", "automation-added"]) {
      // Listen on the parent so the assertion also proves bubbling.
      parent.addEventListener(type, (e) => {
        seen.push({
          type: e.type,
          detail: (e as CustomEvent).detail,
          composed: e.composed,
        });
      });
    }

    dispatchAutomationAdded(host, YAML, { kind: "script", id: "my_script" }, DIFF);

    expect(seen.map((s) => s.type)).toEqual(["yaml-draft", "automation-added"]);
    // The dispatch contract is "the diff-applied YAML", not a
    // particular splice formatting, so compare against
    // applyYamlDiff (which has its own unit tests) ...
    expect(seen[0].detail).toEqual({ yaml: applyYamlDiff(YAML, DIFF) });
    // ... and pin that the new block actually made it into the
    // draft, so a wrong-yaml dispatch still fails loudly here.
    expect((seen[0].detail as { yaml: string }).yaml).toContain(
      "script:\n  - id: my_script"
    );
    expect(seen[1].detail).toEqual({ sectionKey: "automation:script:my_script" });
    // Both events must cross shadow boundaries to reach the page.
    expect(seen.every((s) => s.composed)).toBe(true);
  });

  it("builds the section key from the location for non-script kinds", () => {
    const { parent, host } = mountHost();
    let sectionKey = "";
    parent.addEventListener("automation-added", (e) => {
      sectionKey = (e as CustomEvent<{ sectionKey: string }>).detail.sectionKey;
    });

    dispatchAutomationAdded(
      host,
      YAML,
      { kind: "component_on", component_id: "my_switch", trigger: "on_turn_on" },
      DIFF
    );

    expect(sectionKey).toBe("automation:component_on:my_switch:on_turn_on");
  });
});
