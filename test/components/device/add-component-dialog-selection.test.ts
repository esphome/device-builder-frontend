import { afterEach, describe, expect, test, vi } from "vitest";

import type { ESPHomeAPI } from "../../../src/api/index.js";
import type { ComponentCatalogEntry } from "../../../src/api/types.js";
import {
  hydrateForSelection,
  type SelectionHost,
} from "../../../src/components/device/add-component-dialog-selection.js";
import { _clearComponentCache } from "../../../src/util/component-name-cache.js";
import { makeComponentEntry } from "../../util/_make-component-entry.js";

function makeHost(
  getComponentBodies: (...args: unknown[]) => unknown,
  overrides: Partial<SelectionHost> = {}
): SelectionHost {
  return {
    _api: { getComponentBodies } as unknown as ESPHomeAPI,
    platform: "esp32",
    board: { id: "apollo-esk-1" },
    _selectionSeq: 0,
    _localize: ((key: string) => key) as SelectionHost["_localize"],
    ...overrides,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("hydrateForSelection", () => {
  const wifi = makeComponentEntry("wifi");

  afterEach(() => _clearComponentCache());

  test("returns ok with the full body on a successful fetch", async () => {
    const getComponentBodies = vi.fn().mockResolvedValue({ wifi });
    const host = makeHost(getComponentBodies);

    const result = await hydrateForSelection(host, "wifi");

    expect(result).toEqual({ kind: "ok", entry: wifi });
  });

  test("returns error when the catalog has no entry for the id", async () => {
    const getComponentBodies = vi.fn().mockResolvedValue({});
    const host = makeHost(getComponentBodies);

    const result = await hydrateForSelection(host, "missing.id");

    expect(result).toEqual({
      kind: "error",
      message: "device.add_component_error",
    });
  });

  test("returns error with the thrown message on transport failure", async () => {
    const getComponentBodies = vi.fn().mockRejectedValue(new Error("network down"));
    const host = makeHost(getComponentBodies);

    const result = await hydrateForSelection(host, "wifi");

    expect(result).toEqual({ kind: "error", message: "network down" });
  });

  test("returns stale when the seq bumps before the response lands", async () => {
    const d = deferred<Record<string, ComponentCatalogEntry>>();
    const getComponentBodies = vi.fn().mockReturnValue(d.promise);
    const host = makeHost(getComponentBodies);

    const pending = hydrateForSelection(host, "wifi");
    // Simulate the user clicking something else (or hitting back)
    // before this response arrives.
    host._selectionSeq++;
    d.resolve({ wifi });

    expect(await pending).toEqual({ kind: "stale" });
  });

  test("returns stale when the seq bumps before a transport failure surfaces", async () => {
    // Pins the post-await race the prior `_hydrateBody` shape had:
    // a rejected stale fetch must not surface as an error banner
    // on the newer selection.
    const d = deferred<Record<string, ComponentCatalogEntry>>();
    const getComponentBodies = vi.fn().mockReturnValue(
      d.promise.then(() => {
        throw new Error("stale failure");
      })
    );
    const host = makeHost(getComponentBodies);

    const pending = hydrateForSelection(host, "wifi");
    host._selectionSeq++;
    d.resolve({});

    expect(await pending).toEqual({ kind: "stale" });
  });

  test("honours an explicit boardId override over the host's current board", async () => {
    const getComponentBodies = vi.fn().mockResolvedValue({ wifi });
    const host = makeHost(getComponentBodies);

    await hydrateForSelection(host, "wifi", "esp32-c3-devkitm-1");

    expect(getComponentBodies).toHaveBeenCalledWith(
      ["wifi"],
      "esp32",
      "esp32-c3-devkitm-1"
    );
  });
});
