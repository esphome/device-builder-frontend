// @vitest-environment happy-dom
import "urlpattern-polyfill";
import type { PathRouteConfig } from "@lit-labs/router";
import { LitElement, type TemplateResult } from "lit";
import { describe, expect, it } from "vitest";
import { identityLocalize } from "../../_dom.js";
import type { LocalizeFunc } from "../../../src/common/localize.js";
import { createRouter } from "../../../src/components/app-shell/router.js";

class Host extends LitElement {}
customElements.define("test-router-file-host", Host);

describe("/file/* route", () => {
  it("passes the whole decoded path, slashes included, to the file page", () => {
    const router = createRouter(new Host(), {
      onPending: () => {},
      localize: () => identityLocalize as LocalizeFunc,
      isAuthed: () => true,
    });
    const route = router.routes.find(
      (r): r is PathRouteConfig => "path" in r && r.path === "/file/*"
    )!;
    expect(route).toBeDefined();

    const match = new URLPattern({ pathname: route.path }).exec({
      pathname: "/file/common/my%20dir/a.yaml",
    })!;
    const tpl = route.render!(match.pathname.groups) as TemplateResult;

    expect(tpl.strings.join("")).toContain("<esphome-page-file");
    expect(tpl.values).toContain("common/my dir/a.yaml");
  });
});
