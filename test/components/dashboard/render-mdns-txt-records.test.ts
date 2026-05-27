/**
 * Tests for the drawer's mDNS TXT-records renderer.
 *
 * Drives ``renderMdnsTxtRecords`` — the chevron-collapsible the
 * device drawer mounts under the mDNS reachability row so users
 * can debug what the device is broadcasting (version mismatch,
 * lost ``api_encryption`` advertisement, stale ``mac``). The
 * scenarios pinned here are the ones the drawer's render path
 * actually hits:
 *
 *  1. A real device's TXT payload — produces a ``<details>`` with
 *     a ``<dl>`` of every key/value pair, sorted for stable
 *     ordering across re-pushes.
 *  2. ``null`` / ``undefined`` / empty record sets — render
 *     ``nothing`` so older backends (no ``mdns_txt_records`` field
 *     on the wire) and devices with no TXT cached are visually
 *     unchanged.
 *  3. Injection-safety — values that look like HTML / script tags
 *     stay in the template's ``values`` array as plain strings
 *     and are NEVER spliced into the static template text. Lit's
 *     auto-escaping turns them into text nodes, never markup.
 *  4. Localised summary label — the renderer hands the count to
 *     the localize function via the ``count`` placeholder.
 */
import { nothing } from "lit";
import { describe, expect, it } from "vitest";
import { renderMdnsTxtRecords } from "../../../src/components/dashboard/device-drawer-render.js";
import {
  findTemplatesByAnchor,
  isTemplateResult,
  visitTemplates,
} from "../../_lit-template-walker.js";

const _identityLocalize: (key: string) => string = (key) => key;

describe("renderMdnsTxtRecords", () => {
  it("renders a details/dl with one dt+dd per record, alphabetically sorted", () => {
    // Mirrors the typical ESPHome TXT payload — version,
    // config_hash, mac, api_encryption.
    const records = {
      version: "2025.4.0",
      config_hash: "5a94a12d",
      mac: "aabbccddeeff",
      api_encryption: "Noise_NNpsk0_25519_ChaChaPoly_SHA256",
    };
    const result = renderMdnsTxtRecords(records, _identityLocalize);
    expect(isTemplateResult(result)).toBe(true);

    // One ``<details>`` wraps the whole thing, with a ``<dl>``
    // body holding one row per record.
    const details = findTemplatesByAnchor(result, "<details");
    expect(details.length).toBe(1);
    const dlTemplates = findTemplatesByAnchor(result, "<dl");
    expect(dlTemplates.length).toBe(1);

    // Each record produces one row template carrying ``<dt>`` and
    // ``<dd>`` with two interpolated values: ``[key, value]``.
    // Sort order: the renderer alphabetises by key so chip
    // ordering is stable across re-pushes regardless of how the
    // device serialised its TXT entries.
    const rowTemplates = findTemplatesByAnchor(result, "<dt>");
    expect(rowTemplates.length).toBe(4);
    const pairs = rowTemplates.map((t) => [t.values[0] as string, t.values[1] as string]);
    expect(pairs).toEqual([
      ["api_encryption", "Noise_NNpsk0_25519_ChaChaPoly_SHA256"],
      ["config_hash", "5a94a12d"],
      ["mac", "aabbccddeeff"],
      ["version", "2025.4.0"],
    ]);
  });

  it("keeps empty-string values visible (api_encryption= tri-state)", () => {
    // The backend surfaces ``api_encryption=`` (the "device
    // confirmed plaintext" tri-state signal) as ``""`` so the
    // key stays visible in this debug view. The renderer must
    // emit the dt/dd pair as it would for any other key — the
    // diagnostic value is "this key IS being broadcast", and
    // an empty ``<dd>`` makes the empty value visible at a
    // glance. See backend issue #437 for the upstream context.
    const records = {
      version: "2025.4.0",
      api_encryption: "",
    };
    const result = renderMdnsTxtRecords(records, _identityLocalize);
    const rowTemplates = findTemplatesByAnchor(result, "<dt>");
    expect(rowTemplates.length).toBe(2);
    const pairs = rowTemplates.map((t) => [t.values[0] as string, t.values[1] as string]);
    expect(pairs).toEqual([
      ["api_encryption", ""],
      ["version", "2025.4.0"],
    ]);
  });

  it("does not churn when the input order changes between snapshots", () => {
    // The reachability snapshot fires once per second while the
    // drawer is open. If the backend's TXT decode happens to
    // walk the cached bytes in a different order on consecutive
    // ticks (zeroconf preserves insertion order from the bytes,
    // which can shift on a fresh announce), a naive renderer
    // would emit a different ``values`` sequence each tick and
    // Lit would re-create every ``<dt>`` / ``<dd>`` text node.
    // The renderer's alphabetical sort is what stabilises this
    // — pin the contract: two snapshots with the same content
    // in different orders produce the same value sequence.
    const ascending = {
      api_encryption: "",
      config_hash: "5a94a12d",
      mac: "aabbccddeeff",
      version: "2025.4.0",
    };
    const descending = {
      version: "2025.4.0",
      mac: "aabbccddeeff",
      config_hash: "5a94a12d",
      api_encryption: "",
    };
    const shuffled = {
      mac: "aabbccddeeff",
      version: "2025.4.0",
      api_encryption: "",
      config_hash: "5a94a12d",
    };

    const orderings = [ascending, descending, shuffled].map((records) => {
      const result = renderMdnsTxtRecords(records, _identityLocalize);
      return findTemplatesByAnchor(result, "<dt>").map((t) => [
        t.values[0] as string,
        t.values[1] as string,
      ]);
    });

    // All three orderings collapse to the same alphabetised
    // sequence; without the sort, the second and third would
    // render differently and Lit would tear down + rebuild the
    // dt/dd pairs every tick.
    expect(orderings[0]).toEqual(orderings[1]);
    expect(orderings[0]).toEqual(orderings[2]);
    expect(orderings[0]).toEqual([
      ["api_encryption", ""],
      ["config_hash", "5a94a12d"],
      ["mac", "aabbccddeeff"],
      ["version", "2025.4.0"],
    ]);
  });

  it("returns nothing for null / undefined / empty inputs", () => {
    // Older backends that don't emit ``mdns_txt_records`` push
    // ``undefined`` on the wire — the drawer must render zero
    // markup so the section stays visually identical to the
    // pre-feature drawer.
    expect(renderMdnsTxtRecords(undefined, _identityLocalize)).toBe(nothing);
    // ``null`` is the explicit "backend computed the snapshot but
    // had no TXT to surface" signal. Same: zero markup.
    expect(renderMdnsTxtRecords(null, _identityLocalize)).toBe(nothing);
    // An empty mapping is the legitimate "TXT was decoded but no
    // entries had string values" case — still hide the section,
    // a chevron with zero rows is just visual noise.
    expect(renderMdnsTxtRecords({}, _identityLocalize)).toBe(nothing);
  });

  it("never splices key or value strings into static template text", () => {
    // Injection-safety contract. A malicious device firmware
    // could broadcast a TXT value containing ``<script>`` /
    // ``<img onerror>`` / ``" onclick="`` payloads. Lit's default
    // ``${...}`` interpolation renders them as text nodes, never
    // as markup — but only because the renderer doesn't smuggle
    // values into the static template strings (e.g. via
    // ``unsafeHTML`` or template-literal concatenation). Pin
    // the contract: the rendered template's ``values`` carry the
    // dangerous strings verbatim, and the template's static
    // ``strings`` are entirely renderer-controlled (no
    // user-supplied content).
    const dangerous = {
      version: "<script>alert('xss')</script>",
      config_hash: '" onclick="alert(1)',
      "<key>": "innocent",
    };
    const result = renderMdnsTxtRecords(dangerous, _identityLocalize);

    // Walk every template and confirm:
    // - none of the static ``strings`` contain the dangerous
    //   payloads (proof we didn't concatenate user data into
    //   the template source);
    // - the dangerous payloads DO appear in ``values`` (so they
    //   reach the DOM as text content via Lit's escaping).
    const allStaticText: string[] = [];
    const allValues: unknown[] = [];
    visitTemplates(result, (t) => {
      allStaticText.push(t.strings.join("§"));
      allValues.push(...t.values);
    });
    const staticBlob = allStaticText.join("§§");
    expect(staticBlob).not.toContain("<script>");
    expect(staticBlob).not.toContain("alert('xss')");
    expect(staticBlob).not.toContain('onclick="alert');
    expect(staticBlob).not.toContain("<key>");

    // Values reach the rendered output as plain strings — Lit
    // turns them into text nodes at render time.
    expect(allValues).toContain("<script>alert('xss')</script>");
    expect(allValues).toContain('" onclick="alert(1)');
    expect(allValues).toContain("<key>");
  });

  // Switch keys at the call site (matches the codebase's
  // ``discovered_count_singular`` / ``_plural`` pattern) — a
  // single-record summary picks the singular key, multi-record
  // picks plural. Avoids the "Show 1 mDNS TXT records"
  // ungrammatical fallback that a single-template ``record(s)``
  // shorthand would produce. One parametrised test covers both
  // branches so adding a third (e.g. zero-record, if we ever
  // surface that) lands as a single row rather than another
  // copy-pasted body.
  it.each([
    {
      label: "singular for one record",
      records: { version: "1.0" } as Record<string, string>,
      expectedKey: "dashboard.drawer_show_mdns_txt_records_singular",
      expectedCount: 1,
    },
    {
      label: "plural for two or more records",
      records: { version: "1.0", mac: "aa:bb:cc" } as Record<string, string>,
      expectedKey: "dashboard.drawer_show_mdns_txt_records_plural",
      expectedCount: 2,
    },
  ])("uses the $label summary key", ({ records, expectedKey, expectedCount }) => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    const localize = (key: string, args?: Record<string, unknown>): string => {
      calls.push([key, args]);
      return key;
    };
    renderMdnsTxtRecords(records, localize);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([expectedKey, { count: expectedCount }]);
  });
});
