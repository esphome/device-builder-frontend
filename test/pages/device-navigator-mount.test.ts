/**
 * @vitest-environment happy-dom
 *
 * Pins that the device page mounts one navigator per layout: the drawer
 * copy on mobile, the desktop copy on desktop (hidden by CSS while the
 * sidebar is collapsed, so its search and reveal state survive).
 */
import { describe, expect, it } from "vitest";

import "./_mock-device-children.js";

import {
  extractAttributeBindings,
  findTemplatesByAnchor,
} from "../_lit-template-walker.js";
import type { ESPHomeAPI } from "../../src/api/index.js";
import { ESPHomePageDevice } from "../../src/pages/device.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internals = (page: ESPHomePageDevice) => page as any;

function makePage(opts: { mobile: boolean; navCollapsed?: boolean }): ESPHomePageDevice {
  const page = new ESPHomePageDevice();
  internals(page)._api = {} as ESPHomeAPI;
  page.id = "kitchen.yaml";
  internals(page)._yaml = "esphome:\n  name: kitchen\n";
  internals(page)._savedYaml = internals(page)._yaml;
  internals(page)._load.state = "ready";
  internals(page)._isMobile = opts.mobile;
  internals(page)._navCollapsed = opts.navCollapsed ?? false;
  return page;
}

const navigators = (page: ESPHomePageDevice) =>
  findTemplatesByAnchor(internals(page).render(), "<esphome-device-navigator").map(
    (t) => extractAttributeBindings(t).class
  );

describe("device page navigator mount", () => {
  it("mounts only the desktop navigator on desktop", () => {
    expect(navigators(makePage({ mobile: false }))).toEqual(["desktop-nav"]);
  });

  it("keeps the desktop navigator mounted while the sidebar is collapsed", () => {
    expect(navigators(makePage({ mobile: false, navCollapsed: true }))).toEqual([
      "desktop-nav",
    ]);
  });

  it("mounts only the drawer navigator on mobile, drawer open or closed", () => {
    const page = makePage({ mobile: true });
    expect(navigators(page)).toEqual(["drawer-nav"]);
    internals(page)._drawerOpen = true;
    expect(navigators(page)).toEqual(["drawer-nav"]);
  });
});
