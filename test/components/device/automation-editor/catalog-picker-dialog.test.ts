/**
 * @vitest-environment happy-dom
 *
 * Behavioral tests for ``<esphome-catalog-picker-dialog>``'s filter /
 * grouping contract (#1504):
 *
 * - Search applies case-insensitively across id, name, description.
 * - "By type" groups by the bare domain (``switch.template`` and
 *   ``switch.gpio`` both land under ``switch``) and skips core items.
 * - "Building blocks" filters to ``domain === "core"`` items.
 * - "By target" pre-fills the picked action's id-shaped ConfigEntry
 *   with the picked device's declared id.
 * - The tab strip drops "By target" for conditions.
 *
 * ``open()``'s default-tab contract lives in the sibling
 * ``catalog-picker-dialog-open-contract.test.ts``.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/components/base-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import type {
  AutomationAction,
  AvailableComponentInstance,
} from "../../../../src/api/types/automations.js";
import type { CatalogPickedDetail } from "../../../../src/components/device/automation-editor/catalog-picker-dialog.js";
import { ESPHomeCatalogPickerDialog } from "../../../../src/components/device/automation-editor/catalog-picker-dialog.js";
import { makeConfigEntry } from "../../../../src/util/config-entry-defaults.js";
import { identityLocalize } from "../../../_dom.js";

function action(
  over: Pick<AutomationAction, "id" | "name" | "domain"> & Partial<AutomationAction>
): AutomationAction {
  return {
    description: "",
    docs_url: "",
    config_entries: [],
    is_control_flow: false,
    has_else_branch: false,
    accepts_action_list: [],
    ...over,
  };
}

async function mountDialog(opts: {
  kind?: "action" | "condition";
  items?: AutomationAction[];
  devices?: AvailableComponentInstance[];
  tab?: "by-target" | "by-type" | "building-blocks";
}): Promise<ESPHomeCatalogPickerDialog> {
  const dialog = new ESPHomeCatalogPickerDialog();
  dialog.kind = opts.kind ?? "action";
  dialog.items = opts.items ?? [];
  dialog.devices = opts.devices ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dialog as any)._localize = identityLocalize; // no context provider in the test tree
  document.body.appendChild(dialog);
  dialog.open();
  await dialog.updateComplete;
  if (opts.tab) {
    // Switch tabs the way the user does — through the rendered tab
    // strip — so the @click wiring is covered too.
    const tabs: string[] =
      dialog.kind === "action"
        ? ["by-target", "by-type", "building-blocks"]
        : ["by-type", "building-blocks"];
    const tab =
      dialog.shadowRoot!.querySelectorAll<HTMLElement>(".picker-tab")[
        tabs.indexOf(opts.tab)
      ];
    if (!tab) throw new Error(`Tab ${opts.tab} not rendered for kind ${dialog.kind}`);
    tab.click();
    await dialog.updateComplete;
  }
  return dialog;
}

const rowTitles = (dialog: ESPHomeCatalogPickerDialog): string[] =>
  Array.from(dialog.shadowRoot!.querySelectorAll(".picker-row-title")).map(
    (n) => n.textContent?.trim() ?? ""
  );

const groupLabels = (dialog: ESPHomeCatalogPickerDialog): string[] =>
  Array.from(dialog.shadowRoot!.querySelectorAll(".picker-group-label")).map(
    (n) => n.textContent?.trim() ?? ""
  );

async function search(dialog: ESPHomeCatalogPickerDialog, query: string): Promise<void> {
  const input = dialog.shadowRoot!.querySelector("input")!;
  input.value = query;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await dialog.updateComplete;
}

describe("catalog-picker-dialog search", () => {
  const items = [
    action({ id: "fan.turn_on", name: "Spin", domain: "fan" }),
    action({ id: "light.turn_on", name: "Flicker Glow", domain: "light" }),
    action({
      id: "switch.toggle",
      name: "Toggle",
      domain: "switch",
      description: "Makes things glow nicely",
    }),
  ];

  it("matches case-insensitively across name and description", async () => {
    const dialog = await mountDialog({ items, tab: "by-type" });
    await search(dialog, "GLOW");
    // "Flicker Glow" by name, "Toggle" by description; "Spin" filtered out.
    expect(rowTitles(dialog).sort()).toEqual(["Flicker Glow", "Toggle"]);
  });

  it("matches against the catalog id", async () => {
    const dialog = await mountDialog({ items, tab: "by-type" });
    await search(dialog, "fan.turn");
    expect(rowTitles(dialog)).toEqual(["Spin"]);
  });

  it("shows the empty state when nothing matches", async () => {
    const dialog = await mountDialog({ items, tab: "by-type" });
    await search(dialog, "zzz-no-match");
    expect(rowTitles(dialog)).toEqual([]);
    expect(dialog.shadowRoot!.querySelector(".picker-empty")).not.toBeNull();
  });
});

describe("catalog-picker-dialog grouping", () => {
  it("By type groups platform items under their bare domain and skips core", async () => {
    const dialog = await mountDialog({
      items: [
        action({
          id: "switch.template.toggle",
          name: "Toggle T",
          domain: "switch.template",
        }),
        action({ id: "switch.gpio.toggle", name: "Toggle G", domain: "switch.gpio" }),
        action({ id: "light.turn_on", name: "Turn On", domain: "light" }),
        action({ id: "delay", name: "Delay", domain: "core" }),
      ],
      tab: "by-type",
    });
    // Domains sorted; switch.template + switch.gpio share one "switch"
    // group; the core item lives under Building blocks instead.
    expect(groupLabels(dialog)).toEqual(["light", "switch"]);
    expect(rowTitles(dialog)).toEqual(["Turn On", "Toggle T", "Toggle G"]);
  });

  it("Building blocks lists only domain === 'core' items", async () => {
    const dialog = await mountDialog({
      items: [
        action({ id: "delay", name: "Delay", domain: "core" }),
        action({ id: "switch.toggle", name: "Toggle", domain: "switch" }),
      ],
      tab: "building-blocks",
    });
    expect(rowTitles(dialog)).toEqual(["Delay"]);
  });
});

describe("catalog-picker-dialog by-target pre-fill", () => {
  const turnOn = action({
    id: "switch.turn_on",
    name: "Turn On",
    domain: "switch",
    config_entries: [makeConfigEntry({ key: "id", references_component: "switch" })],
  });

  /** Click the first row; the cell asserts the emitted detail (an
   *  undefined return means the pick never fired). */
  function pickFirstRow(dialog: ESPHomeCatalogPickerDialog): CatalogPickedDetail {
    const picked = vi.fn();
    dialog.addEventListener("catalog-picked", (e) =>
      picked((e as CustomEvent<CatalogPickedDetail>).detail)
    );
    dialog.shadowRoot!.querySelector<HTMLElement>(".picker-row")!.click();
    return picked.mock.calls[0]?.[0] as CatalogPickedDetail;
  }

  it("picking under a declared-id device pre-fills the id-shaped param", async () => {
    const dialog = await mountDialog({
      items: [turnOn],
      devices: [
        {
          component_id: "switch.gpio",
          id: "relay1",
          name: "Warmtepomp",
          has_explicit_id: true,
        },
      ],
      tab: "by-target",
    });
    expect(pickFirstRow(dialog)).toEqual({
      id: "switch.turn_on",
      preFilledParams: { id: "relay1" },
    });
  });

  it("picking under a synthesized-id device leaves the param empty (#2208)", async () => {
    const dialog = await mountDialog({
      items: [turnOn],
      devices: [{ component_id: "switch.gpio", id: "switch_0", name: "Warmtepomp" }],
      tab: "by-target",
    });
    expect(pickFirstRow(dialog)).toEqual({
      id: "switch.turn_on",
      preFilledParams: undefined,
    });
  });
});

describe("catalog-picker-dialog tab strip", () => {
  const tabLabels = (dialog: ESPHomeCatalogPickerDialog): string[] =>
    Array.from(dialog.shadowRoot!.querySelectorAll(".picker-tab")).map(
      (n) => n.textContent?.trim() ?? ""
    );

  it("actions get all three tabs, by-target first", async () => {
    const dialog = await mountDialog({ kind: "action" });
    expect(tabLabels(dialog)).toEqual([
      "device.automation_pick_tab_by_target",
      "device.automation_pick_tab_by_type",
      "device.automation_pick_tab_building_blocks",
    ]);
  });

  it("conditions drop by-target (they have no target)", async () => {
    const dialog = await mountDialog({ kind: "condition" });
    expect(tabLabels(dialog)).toEqual([
      "device.automation_pick_tab_by_type",
      "device.automation_pick_tab_building_blocks",
    ]);
  });
});
