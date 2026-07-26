/**
 * @vitest-environment happy-dom
 *
 * Pins the yaml-draft identity guard (#1479): a draft announced for
 * a different device is dropped instead of spliced into the reused
 * page element's buffer.
 */
import { describe, expect, it } from "vitest";

import "./_mock-device-children.js";

import type { YamlDraftDetail } from "../../src/components/device/section-editor.js";
import { ESPHomePageDevice } from "../../src/pages/device.js";

interface DraftView {
  _yaml: string;
  id: string;
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

describe("yaml-draft identity guard", () => {
  it("applies a draft announced for this device", () => {
    const page = makePage("a:\n");

    draft(page, { configuration: "device.yaml", yaml: "a:\n  x: 1\n" });

    expect(page._yaml).toBe("a:\n  x: 1\n");
  });

  it("drops a draft announced for a different device", () => {
    const page = makePage("b-config:\n");

    // The router reuses the page element across devices; a late
    // upsert echo from the previous device must not splice here.
    draft(page, { configuration: "other.yaml", yaml: "a:\n  x: 1\n" });

    expect(page._yaml).toBe("b-config:\n");
  });
});
