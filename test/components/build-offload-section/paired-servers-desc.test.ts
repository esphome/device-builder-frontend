/**
 * @vitest-environment happy-dom
 *
 * Pins that ``_renderPairedServersDesc`` renders the plain Desktop intro
 * variant (no install link) when ``desktop_version`` is set, and keeps the
 * linked copy everywhere else.
 */
import { describe, expect, it } from "vitest";
import { ESPHomeSettingsBuildOffload } from "../../../src/components/settings-dialog/build-offload-section.js";
import { identityLocalize, renderInto } from "../../_dom.js";

function renderDesc(desktopVersion: string): HTMLElement {
  const fn = (
    ESPHomeSettingsBuildOffload.prototype as unknown as Record<string, () => unknown>
  )._renderPairedServersDesc;
  return renderInto(
    fn.call({ _localize: identityLocalize, _desktopVersion: desktopVersion })
  );
}

describe("_renderPairedServersDesc", () => {
  it("links the ESPHome Desktop docs in the default copy", () => {
    const el = renderDesc("");
    const link = el.querySelector("a.settings-inline-link");
    expect(link).not.toBeNull();
    expect(link!.textContent?.trim()).toBe("settings.esphome_desktop");
    expect(el.textContent).toContain("settings.paired_build_servers_desc");
  });

  it("renders the plain Desktop variant with no link on Desktop", () => {
    const el = renderDesc("1.2.3");
    expect(el.querySelector("a")).toBeNull();
    expect(el.textContent?.trim()).toBe("settings.paired_build_servers_desc_desktop");
  });
});
