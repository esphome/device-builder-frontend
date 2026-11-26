// @vitest-environment happy-dom
import "urlpattern-polyfill";
import type { PathRouteConfig } from "@lit-labs/router";
import { LitElement, type TemplateResult } from "lit";
import { describe, expect, it } from "vitest";
import { identityLocalize } from "../../_dom.js";
import type { LocalizeFunc } from "../../../src/common/localize.js";
import { createRouter } from "../../../src/components/app-shell/router.js";
import { deviceEditorUrl } from "../../../src/util/file-paths.js";

class Host extends LitElement {}
customElements.define("test-router-file-host", Host);

function routeFor(path: string): PathRouteConfig {
  const router = createRouter(new Host(), {
    onPending: () => {},
    localize: () => identityLocalize as LocalizeFunc,
    isAuthed: () => true,
  });
  const route = router.routes.find(
    (r): r is PathRouteConfig => "path" in r && r.path === path
  )!;
  expect(route).toBeDefined();
  return route;
}

function renderAt(route: PathRouteConfig, pathname: string): TemplateResult {
  const match = new URLPattern({ pathname: route.path }).exec({ pathname })!;
  expect(match).not.toBeNull();
  return route.render!(match.pathname.groups) as TemplateResult;
}

describe("/file/* route", () => {
  it("passes the whole decoded path, slashes included, to the file page", () => {
    const tpl = renderAt(routeFor("/file/*"), "/file/common/my%20dir/a.yaml");

    expect(tpl.strings.join("")).toContain("<esphome-page-file");
    expect(tpl.values).toContain("common/my dir/a.yaml");
  });
});

describe("/device/* route", () => {
  it("passes a top-level configuration to the device page", () => {
    const tpl = renderAt(routeFor("/device/*"), "/device/kitchen%20light.yaml");

    expect(tpl.strings.join("")).toContain("<esphome-page-device");
    expect(tpl.values).toContain("kitchen light.yaml");
  });

  it.each(["devices/lights/desk-led-strip.yaml", "devices/lights/desk led#1.yaml"])(
    "round-trips nested configuration %s built by deviceEditorUrl",
    (configuration) => {
      const tpl = renderAt(routeFor("/device/*"), deviceEditorUrl(configuration));

      expect(tpl.values).toContain(configuration);
    }
  );

  it("still accepts an old fully encoded link with %2F", () => {
    const tpl = renderAt(
      routeFor("/device/*"),
      `/device/${encodeURIComponent("devices/lights/desk.yaml")}`
    );

    expect(tpl.values).toContain("devices/lights/desk.yaml");
  });

  it("keeps a malformed escape raw instead of throwing", () => {
    const tpl = renderAt(routeFor("/device/*"), "/device/bad%E0.yaml");

    expect(tpl.values).toContain("bad%E0.yaml");
  });

  it("passes an empty id for a bare /device/ path", () => {
    const tpl = renderAt(routeFor("/device/*"), "/device/");

    expect(tpl.values).toContain("");
  });
});
