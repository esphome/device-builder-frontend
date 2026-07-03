import { afterEach, describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../src/api/index.js";
import type { BoardCatalogEntry } from "../../src/api/types/boards.js";
import {
  _clearBoardBodyCache,
  fetchBoard,
  getCachedBoard,
} from "../../src/util/board-body-cache.js";

const board = (id: string, name: string): BoardCatalogEntry =>
  ({ id, name }) as BoardCatalogEntry;

interface MockApi {
  api: ESPHomeAPI;
  getBoard: ReturnType<typeof vi.fn>;
}

const mockApi = (
  impl: (id: string) => BoardCatalogEntry | null,
  overridePromise?: () => Promise<BoardCatalogEntry | null>
): MockApi => {
  const getBoard = vi.fn((id: string) =>
    overridePromise ? overridePromise() : Promise.resolve(impl(id))
  );
  return { api: { getBoard } as unknown as ESPHomeAPI, getBoard };
};

describe("board-body-cache", () => {
  afterEach(() => {
    _clearBoardBodyCache();
  });

  it("fetches an uncached board and caches the result", async () => {
    const { api, getBoard } = mockApi(() => board("esp32dev", "ESP32 Dev"));

    expect(getCachedBoard("esp32dev")).toBeUndefined();
    const got = await fetchBoard(api, "esp32dev");

    expect(got?.name).toBe("ESP32 Dev");
    expect(getBoard).toHaveBeenCalledTimes(1);
    expect(getCachedBoard("esp32dev")?.name).toBe("ESP32 Dev");

    await fetchBoard(api, "esp32dev");
    expect(getBoard).toHaveBeenCalledTimes(1);
  });

  it("fans a bucket out to one getBoard per distinct id", async () => {
    const { api, getBoard } = mockApi((id) => board(id, `name:${id}`));

    const [a, b] = await Promise.all([
      fetchBoard(api, "esp32dev"),
      fetchBoard(api, "esp8266"),
    ]);

    expect(a?.name).toBe("name:esp32dev");
    expect(b?.name).toBe("name:esp8266");
    expect(getBoard).toHaveBeenCalledTimes(2);
    expect(getBoard).toHaveBeenCalledWith("esp32dev");
    expect(getBoard).toHaveBeenCalledWith("esp8266");
  });

  it("isolates a per-id failure so an innocent board in the same bucket resolves", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const getBoard = vi.fn((id: string) =>
      id === "bad"
        ? Promise.reject(new Error("transport"))
        : Promise.resolve(board(id, `name:${id}`))
    );
    const api = { getBoard } as unknown as ESPHomeAPI;

    // Same tick ⇒ same bucket; a plain Promise.all would reject the good one too.
    const [good, bad] = await Promise.all([
      fetchBoard(api, "esp32dev"),
      fetchBoard(api, "bad"),
    ]);

    expect(good?.name).toBe("name:esp32dev");
    expect(bad).toBeNull();
    expect(getCachedBoard("esp32dev")?.name).toBe("name:esp32dev");
    // The failed id stays uncached (cacheMisses: false), so it can recover.
    expect(getCachedBoard("bad")).toBeUndefined();
    warn.mockRestore();
  });

  it("handles a board id of __proto__ without corrupting the accumulator", async () => {
    const { api } = mockApi((id) => board(id, `name:${id}`));

    const [proto, normal] = await Promise.all([
      fetchBoard(api, "__proto__"),
      fetchBoard(api, "esp32dev"),
    ]);

    // A plain-object accumulator loses the __proto__ write (and rewires its
    // prototype); the null-prototype record stores it as a normal own key.
    expect(proto?.name).toBe("name:__proto__");
    expect(normal?.name).toBe("name:esp32dev");
    expect(getCachedBoard("__proto__")?.name).toBe("name:__proto__");
  });

  it("coalesces concurrent in-flight fetches for the same id", async () => {
    let resolve!: (v: BoardCatalogEntry | null) => void;
    const { api, getBoard } = mockApi(
      () => null,
      () => new Promise<BoardCatalogEntry | null>((r) => (resolve = r))
    );

    const a = fetchBoard(api, "esp32dev");
    const b = fetchBoard(api, "esp32dev");

    await Promise.resolve();
    expect(getBoard).toHaveBeenCalledTimes(1);

    resolve(board("esp32dev", "ESP32 Dev"));
    await expect(a).resolves.toMatchObject({ name: "ESP32 Dev" });
    await expect(b).resolves.toMatchObject({ name: "ESP32 Dev" });
    expect(getBoard).toHaveBeenCalledTimes(1);
  });

  it("does not cache misses (a null id may recover on retry)", async () => {
    let attempts = 0;
    const { api, getBoard } = mockApi(
      () => null,
      () => {
        attempts++;
        return Promise.resolve(attempts === 1 ? null : board("esp32dev", "Recovered"));
      }
    );

    const first = await fetchBoard(api, "esp32dev");
    expect(first).toBeNull();
    expect(getCachedBoard("esp32dev")).toBeUndefined();

    const second = await fetchBoard(api, "esp32dev");
    expect(second?.name).toBe("Recovered");
    expect(getBoard).toHaveBeenCalledTimes(2);
  });

  it("rejects pending waiters when the cache is cleared mid-flight", async () => {
    const { api } = mockApi(
      () => null,
      () => new Promise<BoardCatalogEntry | null>(() => {})
    );

    const pending = fetchBoard(api, "esp32dev");
    _clearBoardBodyCache();

    await expect(pending).rejects.toThrow("board-body-cache cleared");
  });
});
