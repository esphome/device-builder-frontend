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
    announce(false, { yaml: "b:\n", basedOn: "a:\n" });

    expect(seen).toEqual([{ yaml: "b:\n", basedOn: "a:\n" }]);
  });
});
