import type { ReactiveController, ReactiveControllerHost } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ESPHomeAPI } from "../../src/api/index.js";
import { CatalogIndexController } from "../../src/util/catalog-index-controller.js";
import { _clearCatalogCache } from "../../src/util/yaml-completion-catalog.js";

const stubHost = () => {
  let controller: ReactiveController | null = null;
  const requestUpdate = vi.fn();
  const host: ReactiveControllerHost = {
    addController: (c) => {
      controller = c;
    },
    removeController: () => {},
    requestUpdate,
    updateComplete: Promise.resolve(true),
  };
  return {
    host,
    requestUpdate,
    connect: () => controller?.hostConnected?.(),
    updated: () => controller?.hostUpdated?.(),
  };
};

const makeApi = () => {
  const getComponents = vi.fn(async () => ({
    components: [{ id: "wifi" }],
    categories: [],
    total: 1,
    offset: 0,
    limit: 1000,
  }));
  return { api: { getComponents } as unknown as ESPHomeAPI, getComponents };
};

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("CatalogIndexController", () => {
  afterEach(() => _clearCatalogCache());

  it("loads the index on connect and re-renders the host", async () => {
    const { host, requestUpdate, connect } = stubHost();
    const { api } = makeApi();
    const ctl = new CatalogIndexController(host, () => api);
    expect(ctl.index).toBeNull();
    connect();
    await flush();
    expect(ctl.index?.byId.has("wifi")).toBe(true);
    expect(requestUpdate).toHaveBeenCalled();
  });

  it("starts once the api arrives via hostUpdated", async () => {
    const { host, connect, updated } = stubHost();
    const { api, getComponents } = makeApi();
    let ready = false;
    const ctl = new CatalogIndexController(host, () => (ready ? api : undefined));
    connect();
    await flush();
    expect(ctl.index).toBeNull();
    ready = true;
    updated();
    await flush();
    expect(ctl.index?.byId.has("wifi")).toBe(true);
    expect(getComponents).toHaveBeenCalledTimes(1);
  });

  it("loads at most once per controller", async () => {
    const { host, connect, updated } = stubHost();
    const { api, getComponents } = makeApi();
    new CatalogIndexController(host, () => api);
    connect();
    updated();
    updated();
    await flush();
    expect(getComponents).toHaveBeenCalledTimes(1);
  });
});
