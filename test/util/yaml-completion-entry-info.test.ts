// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { entryToCompletion } from "../../src/util/yaml-completion-items.js";
import { makeConfigEntry } from "./_make-config-entry.js";

// The `info` callback renders the hover popover for a config entry. The
// guard that decides whether to render at all must treat `default_value`
// as present whenever it is anything other than null/undefined — a falsy
// `0` / `false` default is still a default worth showing.
describe("entryToCompletion info popover", () => {
  const renderInfo = (entry: Parameters<typeof entryToCompletion>[0]) => {
    const { info } = entryToCompletion(entry);
    expect(typeof info).toBe("function");
    return (info as () => HTMLElement | null)();
  };

  it("renders the Default line for a falsy 0 default", () => {
    const dom = renderInfo(
      makeConfigEntry({
        key: "update_interval",
        description: null,
        range: null,
        default_value: 0,
      })
    );
    expect(dom).not.toBeNull();
    expect(dom!.textContent).toContain("Default: 0");
  });

  it("renders the Default line for a falsy false default", () => {
    const dom = renderInfo(
      makeConfigEntry({
        key: "internal",
        description: null,
        range: null,
        default_value: false,
      })
    );
    expect(dom).not.toBeNull();
    expect(dom!.textContent).toContain("Default: false");
  });

  it("renders nothing when there is no description, default, or range", () => {
    const dom = renderInfo(
      makeConfigEntry({
        key: "name",
        description: null,
        range: null,
        default_value: null,
      })
    );
    expect(dom).toBeNull();
  });
});
