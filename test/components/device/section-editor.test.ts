/**
 * Pins the anchored yaml-updated announcer: the anchor is captured
 * before the awaits and the write's basis rides the typed detail.
 */
import { describe, expect, it } from "vitest";

import { prepareYamlUpdated } from "../../../src/components/device/section-editor.js";

describe("prepareYamlUpdated", () => {
  it("captures the anchor before the awaits and carries the basis", () => {
    const anchor = new EventTarget();
    const host = Object.assign(new EventTarget(), {
      parentNode: anchor as unknown as ParentNode,
    });
    const seen: { yaml: string; basedOn?: string }[] = [];
    anchor.addEventListener("yaml-updated", (e) =>
      seen.push((e as CustomEvent<{ yaml: string; basedOn?: string }>).detail)
    );

    const announce = prepareYamlUpdated(host);
    // The host unmounts mid round trip; the announcement still rides
    // the anchor captured up front and carries the write's basis.
    host.parentNode = null as unknown as ParentNode;
    announce(false, {
      yaml: "b:\n",
      basedOn: "a:\n",
      removed: { kind: "component", sectionKey: "wifi", fromLine: 0 },
    });

    expect(seen).toEqual([
      {
        yaml: "b:\n",
        basedOn: "a:\n",
        removed: { kind: "component", sectionKey: "wifi", fromLine: 0 },
      },
    ]);
  });

  it("dispatches from the host while it is still connected", () => {
    const anchor = new EventTarget();
    const host = Object.assign(new EventTarget(), {
      parentNode: anchor as unknown as ParentNode,
    });
    const seen: string[] = [];
    host.addEventListener("yaml-updated", () => seen.push("host"));
    anchor.addEventListener("yaml-updated", () => seen.push("anchor"));

    prepareYamlUpdated(host)(true, {
      yaml: "b:\n",
      basedOn: "a:\n",
      removed: { kind: "component", sectionKey: "wifi", fromLine: 0 },
    });

    expect(seen).toEqual(["host"]);
  });

  it("silently no-ops when a never-mounted host is disconnected", () => {
    const host = Object.assign(new EventTarget(), { parentNode: null });
    const seen: string[] = [];
    host.addEventListener("yaml-updated", () => seen.push("host"));

    // Deliberate contract: a host that never mounted has nowhere to
    // deliver — swallow rather than throw.
    prepareYamlUpdated(host)(false, {
      yaml: "b:\n",
      basedOn: "a:\n",
      removed: { kind: "component", sectionKey: "wifi", fromLine: 0 },
    });

    expect(seen).toEqual([]);
  });
});
