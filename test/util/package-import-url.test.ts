/**
 * Tests for the ``package_import_url`` shorthand → browser-URL
 * converter used by the Take-Control dialog.
 *
 * The shorthand grammar mirrors ESPHome's
 * ``git.GitFile.from_shorthand`` (``esphome/git.py:289``). These
 * tests pin both halves: the recognised shapes resolve to a real
 * github.com / gitlab.com / codeberg.org file-browse URL the browser
 * can open (``blob/<ref>/<file>`` on GitHub and GitLab,
 * ``src/<ref>/<file>`` on Codeberg), and unrecognised values fall
 * back to ``browseUrl: null`` so the dialog renders them as plain
 * text.
 */

import { describe, expect, it } from "vitest";

import { previewPackageImportUrl } from "../../src/util/package-import-url.js";

describe("previewPackageImportUrl - github://", () => {
  it("resolves a basic shorthand with @ref", () => {
    const out = previewPackageImportUrl(
      "github://athom-tech/athom-configs/athom-rgbct-light.yaml@v1.0.0"
    );
    expect(out.browseUrl).toBe(
      "https://github.com/athom-tech/athom-configs/blob/v1.0.0/athom-rgbct-light.yaml"
    );
    expect(out.service).toBe("github");
    expect(out.raw).toBe(
      "github://athom-tech/athom-configs/athom-rgbct-light.yaml@v1.0.0"
    );
  });

  it("falls back to HEAD when @ref is omitted", () => {
    // Vendor firmware sometimes ships without a pinned ref so the
    // import always pulls latest. The browse URL still has to point
    // somewhere — ``HEAD`` is what GitHub's blob view falls back to
    // for the default branch.
    const out = previewPackageImportUrl(
      "github://athom-tech/athom-configs/athom-rgbct-light.yaml"
    );
    expect(out.browseUrl).toBe(
      "https://github.com/athom-tech/athom-configs/blob/HEAD/athom-rgbct-light.yaml"
    );
    expect(out.service).toBe("github");
  });

  it("handles a deep nested file path (Apollo-style)", () => {
    // Apollo and similar vendors use multi-level paths under their
    // monorepo. Pinning this case so a regex-tightening that broke
    // ``/`` in the filename wouldn't slip through CI.
    const out = previewPackageImportUrl(
      "github://ApolloAutomation/PUMP-1/Integrations/ESPHome/PUMP-1_Minimal.yaml@main"
    );
    expect(out.browseUrl).toBe(
      "https://github.com/ApolloAutomation/PUMP-1/blob/main/Integrations/ESPHome/PUMP-1_Minimal.yaml"
    );
    expect(out.service).toBe("github");
  });

  it("ignores ?query suffixes (?full_config)", () => {
    // ESPHome's own ``dashboard_import.to_code`` appends
    // ``?full_config`` to import URLs when the
    // ``import_full_config`` config flag is set. The query is
    // semantic to ESPHome only — for the browse URL we drop it,
    // since GitHub doesn't know what ``?full_config`` means.
    const out = previewPackageImportUrl(
      "github://athom-tech/athom-configs/athom-rgbct-light.yaml@v1.0.0?full_config"
    );
    expect(out.browseUrl).toBe(
      "https://github.com/athom-tech/athom-configs/blob/v1.0.0/athom-rgbct-light.yaml"
    );
  });
});

describe("previewPackageImportUrl - gitlab://", () => {
  it("resolves a basic shorthand with @ref", () => {
    // GitLab's blob route is ``-/blob/<ref>/<path>`` — note the
    // ``-/`` segment that GitHub doesn't have.
    const out = previewPackageImportUrl(
      "gitlab://example-group/example-repo/configs/device.yaml@v1.0.0"
    );
    expect(out.browseUrl).toBe(
      "https://gitlab.com/example-group/example-repo/-/blob/v1.0.0/configs/device.yaml"
    );
    expect(out.service).toBe("gitlab");
  });

  it("falls back to HEAD when @ref is omitted", () => {
    const out = previewPackageImportUrl(
      "gitlab://example-group/example-repo/configs/device.yaml"
    );
    expect(out.browseUrl).toBe(
      "https://gitlab.com/example-group/example-repo/-/blob/HEAD/configs/device.yaml"
    );
  });
});

describe("previewPackageImportUrl - codeberg://", () => {
  it("resolves a basic shorthand with @ref", () => {
    // Forgejo's browse routes are typed (``src/branch/<ref>`` vs
    // ``src/tag/<ref>`` vs ``src/commit/<sha>``) and the shorthand
    // doesn't say which kind of ref ``@v1.0.0`` is. We use the
    // untyped ``src/<ref>/<path>`` form instead, which Forgejo
    // resolves server-side and redirects to the right typed route -
    // ``src/branch/<tag>`` would 404 for a tag ref.
    const out = previewPackageImportUrl(
      "codeberg://example-owner/example-repo/configs/device.yaml@v1.0.0"
    );
    expect(out.browseUrl).toBe(
      "https://codeberg.org/example-owner/example-repo/src/v1.0.0/configs/device.yaml"
    );
    expect(out.service).toBe("codeberg");
    expect(out.raw).toBe(
      "codeberg://example-owner/example-repo/configs/device.yaml@v1.0.0"
    );
  });

  it("falls back to HEAD when @ref is omitted", () => {
    // Forgejo redirects ``src/HEAD/<path>`` to the repo's default
    // branch, so ``HEAD`` works as the untyped-route fallback too.
    const out = previewPackageImportUrl(
      "codeberg://example-owner/example-repo/configs/device.yaml"
    );
    expect(out.browseUrl).toBe(
      "https://codeberg.org/example-owner/example-repo/src/HEAD/configs/device.yaml"
    );
    expect(out.service).toBe("codeberg");
  });

  it("ignores ?query suffixes (?full_config)", () => {
    const out = previewPackageImportUrl(
      "codeberg://example-owner/example-repo/configs/device.yaml@v1.0.0?full_config"
    );
    expect(out.browseUrl).toBe(
      "https://codeberg.org/example-owner/example-repo/src/v1.0.0/configs/device.yaml"
    );
    expect(out.service).toBe("codeberg");
  });
});

describe("previewPackageImportUrl - fall-through to plain text", () => {
  it("returns null browseUrl for empty / null / undefined input", () => {
    expect(previewPackageImportUrl("").browseUrl).toBe(null);
    expect(previewPackageImportUrl(null).browseUrl).toBe(null);
    expect(previewPackageImportUrl(undefined).browseUrl).toBe(null);
    expect(previewPackageImportUrl("").raw).toBe("");
  });

  it("returns null browseUrl for unknown shorthand domains", () => {
    // Future-proof: if upstream ESPHome adds bitbucket support and
    // a vendor starts shipping ``bitbucket://…`` URLs before we
    // update this util, we render them as plain text rather than
    // fabricating a wrong click target.
    const out = previewPackageImportUrl("bitbucket://owner/repo/file.yaml@main");
    expect(out.browseUrl).toBe(null);
    expect(out.service).toBe(null);
    expect(out.raw).toBe("bitbucket://owner/repo/file.yaml@main");
  });

  it("returns null browseUrl for domains that only exist on the object prototype", () => {
    // The host table is a plain object keyed by domain. A shorthand
    // whose domain names an inherited property must miss the table,
    // not resolve to a prototype function.
    for (const raw of [
      "constructor://owner/repo/file.yaml@main",
      "toString://owner/repo/file.yaml",
      "hasOwnProperty://owner/repo/file.yaml",
    ]) {
      const out = previewPackageImportUrl(raw);
      expect(out.browseUrl).toBe(null);
      expect(out.service).toBe(null);
      expect(out.raw).toBe(raw);
    }
  });

  it("returns null browseUrl for plain http(s) URLs", () => {
    // ``dashboard_import`` only accepts shorthand — plain
    // http(s) URLs would be rejected at adoption time. Don't
    // render them as a clickable preview either; the user
    // sees the raw value and the missing link is the
    // signal that it won't import.
    expect(
      previewPackageImportUrl("https://github.com/o/r/blob/main/x.yaml").browseUrl
    ).toBe(null);
    expect(previewPackageImportUrl("http://example.com/foo.yaml").browseUrl).toBe(null);
  });

  it("returns null browseUrl for arbitrary garbage", () => {
    // Defense in depth: a malicious mDNS broadcaster could put
    // anything in the TXT field. The dialog renders the raw text
    // (so the user can read what's there) but skips the click
    // target.
    expect(previewPackageImportUrl("javascript:alert(1)").browseUrl).toBe(null);
    expect(previewPackageImportUrl("not a url at all").browseUrl).toBe(null);
    expect(
      previewPackageImportUrl("github://owner/repo/file.yaml javascript:").browseUrl
    ).toBe(null);
  });

  it("preserves the raw value even when the URL is unparseable", () => {
    // The dialog still shows the raw value so the user can read
    // exactly what got broadcast. Only the click affordance is
    // dropped.
    const out = previewPackageImportUrl("totally bogus");
    expect(out.raw).toBe("totally bogus");
    expect(out.browseUrl).toBe(null);
  });
});
