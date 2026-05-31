/**
 * Unit tests for ``ParseErrorController.resolve`` — the classify step
 * behind the editors' read-only-on-parse-error behaviour (#1050).
 */
import type { ReactiveControllerHost } from "lit";
import { describe, expect, it, vi } from "vitest";

import type {
  AutomationLocation,
  ParsedAutomation,
} from "../../../../src/api/types/automations.js";
import { ParseErrorController } from "../../../../src/components/device/automation-editor/parse-error-controller.js";

const fakeHost = (): ReactiveControllerHost =>
  ({
    addController: vi.fn(),
    removeController: vi.fn(),
    requestUpdate: vi.fn(),
    updateComplete: Promise.resolve(true),
  }) as unknown as ReactiveControllerHost;

const SCRIPT: AutomationLocation = {
  kind: "script",
  id: "s1",
} as unknown as AutomationLocation;

const parsed = (over: Partial<ParsedAutomation>): ParsedAutomation =>
  ({
    location: SCRIPT,
    label: "Script: s1",
    automation: { trigger_id: null, trigger_params: {}, actions: [] },
    from_line: 1,
    to_line: 2,
    raw_yaml: "",
    ...over,
  }) as ParsedAutomation;

describe("ParseErrorController.resolve", () => {
  it("returns the editable tree and stays inactive for a clean match", () => {
    const c = new ParseErrorController(fakeHost());
    const tree = { trigger_id: null, trigger_params: {}, actions: [] };
    const m = c.resolve([parsed({ automation: tree })], SCRIPT, "script");
    expect(m?.tree).toBe(tree);
    expect(c.active).toBe(false);
  });

  it("re-pins to the parser's matched location, not the caller's", () => {
    // The editor adopts ``m.location`` so the writer round-trips
    // against the parser's canonical form, not the navigator's input.
    const c = new ParseErrorController(fakeHost());
    const parserLoc = { kind: "script", id: "s1" } as unknown as AutomationLocation;
    const m = c.resolve([parsed({ location: parserLoc })], SCRIPT, "script");
    expect(m?.location).toBe(parserLoc);
  });

  it("goes read-only and withholds the tree on a parse error", () => {
    const c = new ParseErrorController(fakeHost());
    expect(
      c.resolve([parsed({ error: "Unknown action id: 'x'" })], SCRIPT, "script")
    ).toBeNull();
    expect(c.active).toBe(true);
  });

  it("treats an empty-string error as read-only (wire type allows any string)", () => {
    const c = new ParseErrorController(fakeHost());
    expect(c.resolve([parsed({ error: "" })], SCRIPT, "script")).toBeNull();
    expect(c.active).toBe(true);
  });

  it("returns null and stays inactive when nothing matches", () => {
    const c = new ParseErrorController(fakeHost());
    const other = { kind: "script", id: "other" } as unknown as AutomationLocation;
    expect(c.resolve([parsed({})], other, "script")).toBeNull();
    expect(c.active).toBe(false);
  });

  it("matches a backend index:null component_on against an index-less location", () => {
    // #1094: the parser emits ``index: null`` for a single (non-list)
    // component_on handler, while the navigator routes the click with
    // no ``index`` at all. Both must resolve to the same automation so
    // re-selecting an automation rehydrates its actions instead of an
    // empty tree.
    const c = new ParseErrorController(fakeHost());
    const navLoc = {
      kind: "component_on",
      component_id: "binary_sensor_0",
      trigger: "on_state",
    } as unknown as AutomationLocation;
    const tree = {
      trigger_id: "binary_sensor.on_state",
      trigger_params: {},
      actions: [{ action_id: "logger.log", params: {}, children: {}, conditions: [] }],
    };
    const parserLoc = {
      kind: "component_on",
      component_id: "binary_sensor_0",
      trigger: "on_state",
      index: null,
    } as unknown as AutomationLocation;
    const m = c.resolve(
      [parsed({ location: parserLoc, automation: tree })],
      navLoc,
      "component_on"
    );
    expect(m?.tree).toBe(tree);
    expect(c.active).toBe(false);
  });

  it("rejects a same-key entry of the wrong kind", () => {
    const c = new ParseErrorController(fakeHost());
    expect(c.resolve([parsed({})], SCRIPT, "api_action")).toBeNull();
    expect(c.active).toBe(false);
  });

  it("clears read-only state when a later resolve matches cleanly", () => {
    const c = new ParseErrorController(fakeHost());
    c.resolve([parsed({ error: "boom" })], SCRIPT, "script");
    expect(c.active).toBe(true);
    c.resolve([parsed({})], SCRIPT, "script");
    expect(c.active).toBe(false);
  });

  it("clears read-only state when a later resolve finds no match", () => {
    // Navigating from an errored automation to a missing/unparsed one
    // must not leave the editor latched read-only with a stale error.
    const c = new ParseErrorController(fakeHost());
    c.resolve([parsed({ error: "boom" })], SCRIPT, "script");
    expect(c.active).toBe(true);
    c.resolve([], SCRIPT, "script");
    expect(c.active).toBe(false);
  });
});
