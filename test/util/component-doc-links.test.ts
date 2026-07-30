/**
 * @vitest-environment happy-dom
 *
 * Pins the description component-link contract: only known catalog ids
 * spelled as `name:` code spans link, a present component navigates to
 * its section, an absent one requests the targeted add flow.
 */
import { describe, expect, it } from "vitest";

import type { ComponentCatalogEntry } from "../../src/api/types/components.js";
import {
  activateComponentLink,
  componentIdFromCodeSpan,
  componentLinksFor,
  type ComponentLinkHost,
} from "../../src/util/component-doc-links.js";
import type { CatalogIndex } from "../../src/util/yaml-completion-catalog.js";
import { _clearYamlSectionsMemo } from "../../src/util/yaml-sections-core.js";

function makeIndex(...ids: string[]): CatalogIndex {
  return {
    components: [],
    byId: new Map(ids.map((id) => [id, { id } as ComponentCatalogEntry])),
    byCategory: new Map(),
  };
}

function makeHost(yaml: string): ComponentLinkHost & HTMLElement {
  const el = document.createElement("div") as unknown as HTMLElement & { yaml: string };
  el.yaml = yaml;
  document.body.appendChild(el);
  return el;
}

describe("componentIdFromCodeSpan", () => {
  it.each([
    ["captive_portal:", "captive_portal"],
    ["web_server:", "web_server"],
    ["sensor.dht:", "sensor.dht"],
  ])("accepts %s", (span, id) => {
    expect(componentIdFromCodeSpan(span)).toBe(id);
  });

  it.each(["wifi", "Foo:", ":", "wi fi:", "${var}:", "true"])("rejects %s", (span) => {
    expect(componentIdFromCodeSpan(span)).toBeNull();
  });
});

describe("componentLinksFor", () => {
  it("is null while the index is unsettled", () => {
    expect(componentLinksFor(makeHost(""), null)).toBeNull();
  });

  it("resolves known ids to a handler and unknown ids to null", () => {
    const resolve = componentLinksFor(makeHost(""), makeIndex("captive_portal"))!;
    expect(resolve("captive_portal:")).toBeTypeOf("function");
    expect(resolve("id:")).toBeNull();
    expect(resolve("captive_portal")).toBeNull();
  });

  it("folds the rp2040 alias onto the catalog's canonical id", () => {
    const resolve = componentLinksFor(makeHost(""), makeIndex("rp2"))!;
    expect(resolve("rp2040:")).toBeTypeOf("function");
  });

  it("keeps a stable identity for the same host and index", () => {
    const host = makeHost("");
    const index = makeIndex("wifi");
    expect(componentLinksFor(host, index)).toBe(componentLinksFor(host, index));
  });
});

describe("activateComponentLink", () => {
  it("navigates to the section when the component is present", () => {
    _clearYamlSectionsMemo();
    const host = makeHost("esphome:\n  name: x\nweb_server:\n  port: 80\n");
    let detail: unknown;
    host.addEventListener("section-select", (e) => {
      detail = (e as CustomEvent).detail;
    });
    activateComponentLink(host, "web_server");
    expect(detail).toEqual({ sectionKey: "web_server", fromLine: expect.any(Number) });
  });

  it("requests the targeted add flow when the component is absent", () => {
    _clearYamlSectionsMemo();
    const host = makeHost("esphome:\n  name: x\n");
    let detail: unknown;
    host.addEventListener("request-add-component", (e) => {
      detail = (e as CustomEvent).detail;
    });
    activateComponentLink(host, "captive_portal");
    expect(detail).toEqual({ domain: "captive_portal", componentId: "captive_portal" });
  });

  it("reads the live yaml at click time", () => {
    _clearYamlSectionsMemo();
    const host = makeHost("esphome:\n  name: x\n");
    const resolve = componentLinksFor(host, makeIndex("web_server"))!;
    const handler = resolve("web_server:")!;
    host.yaml = "esphome:\n  name: x\nweb_server:\n  port: 80\n";
    let selected = false;
    host.addEventListener("section-select", () => {
      selected = true;
    });
    handler();
    expect(selected).toBe(true);
  });
});
