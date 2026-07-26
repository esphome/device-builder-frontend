/**
 * Pins the anchored yaml-updated announcer: the anchor is captured
 * before the awaits and the write's basis rides the typed detail.
 */
import { describe, expect, it } from "vitest";

import { prepareSectionEvent } from "../../../src/components/device/section-editor.js";

describe("prepareSectionEvent", () => {
  it("captures the anchor before the awaits and carries the basis", () => {
    const anchor = new EventTarget();
    const host = Object.assign(new EventTarget(), {
      parentNode: anchor as unknown as ParentNode,
    });
    const seen: { yaml: string; basedOn?: string }[] = [];
    anchor.addEventListener("yaml-updated", (e) =>
      seen.push((e as CustomEvent<{ yaml: string; basedOn?: string }>).detail)
    );

    const announce = prepareSectionEvent(host, "yaml-updated");
    // The host unmounts mid round trip; the announcement still rides
    // the anchor captured up front and carries the write's basis.
    host.parentNode = null as unknown as ParentNode;
    announce(false, {
      configuration: "device.yaml",
      yaml: "b:\n",
      basedOn: "a:\n",
      removed: { kind: "component", sectionKey: "wifi", fromLine: 1 },
    });

    expect(seen).toEqual([
      {
        configuration: "device.yaml",
        yaml: "b:\n",
        basedOn: "a:\n",
        removed: { kind: "component", sectionKey: "wifi", fromLine: 1 },
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

    prepareSectionEvent(host, "yaml-updated")(true, {
      configuration: "device.yaml",
      yaml: "b:\n",
      basedOn: "a:\n",
      removed: { kind: "component", sectionKey: "wifi", fromLine: 1 },
    });

    expect(seen).toEqual(["host"]);
  });

  it("silently no-ops when a never-mounted host is disconnected", () => {
    const host = Object.assign(new EventTarget(), { parentNode: null });
    const seen: string[] = [];
    host.addEventListener("yaml-updated", () => seen.push("host"));

    // Deliberate contract: a host that never mounted has nowhere to
    // deliver — swallow rather than throw.
    prepareSectionEvent(host, "yaml-updated")(false, {
      configuration: "device.yaml",
      yaml: "b:\n",
      basedOn: "a:\n",
      removed: { kind: "component", sectionKey: "wifi", fromLine: 1 },
    });

    expect(seen).toEqual([]);
  });
});
