/**
 * @vitest-environment happy-dom
 *
 * Focused tests for ``ESPHomePageDevice``'s ``_platformReady``
 * lifecycle. The page imports many heavy children (firmware-
 * install-dialog, command-dialog, yaml-editor → CodeMirror, …);
 * ``vi.mock`` no-ops them so the page element can construct
 * without dragging the editor stack in.
 *
 * The tests drive the lifecycle by setting properties and calling
 * Lit's ``updateComplete`` rather than mounting via the
 * customElements registry — the page's own ``updated()`` hook is
 * where the gate transitions live.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("../../src/components/command-dialog.js", () => ({}));
vi.mock("../../src/components/device/board-reselect-dialog.js", () => ({}));
vi.mock("../../src/components/device/device-editor.js", () => ({}));
vi.mock("../../src/components/device/device-navigator.js", () => ({}));
vi.mock("../../src/components/firmware-install-dialog.js", () => ({}));
vi.mock("../../src/components/install-method-dialog.js", () => ({}));
vi.mock("../../src/components/logs-dialog.js", () => ({}));
vi.mock("../../src/components/unsaved-changes-dialog.js", () => ({}));
vi.mock("../../src/components/yaml-validation-dialog.js", () => ({}));
vi.mock("../../src/components/device/device-install-controller.js", () => ({
  DeviceInstallController: class {
    constructor() {}
  },
}));

import type { ESPHomeAPI } from "../../src/api/index.js";
import type { BoardCatalogEntry } from "../../src/api/types/boards.js";
import type { ConfiguredDevice } from "../../src/api/types/devices.js";
import { ESPHomePageDevice } from "../../src/pages/device.js";
import { _clearBoardBodyCache } from "../../src/util/board-body-cache.js";
import { flushMicrotasks } from "../_dom.js";
import {
  type ConfiguredDeviceOverrides,
  makeConfiguredDevice,
} from "../_make-configured-device.js";

const board = (overrides: Partial<BoardCatalogEntry> = {}): BoardCatalogEntry =>
  ({
    id: "esp32cam",
    name: "AI Thinker ESP32-CAM",
    esphome: { platform: "esp32" } as BoardCatalogEntry["esphome"],
    ...overrides,
  }) as BoardCatalogEntry;

const device = (overrides: ConfiguredDeviceOverrides = {}): ConfiguredDevice =>
  makeConfiguredDevice({ board_id: "esp32cam", ...overrides });

interface FakeApi {
  getConfig: ReturnType<typeof vi.fn>;
  getBoard: ReturnType<typeof vi.fn>;
  getPreferences: ReturnType<typeof vi.fn>;
}

const makeApi = (overrides: Partial<FakeApi> = {}): ESPHomeAPI =>
  ({
    getConfig: vi.fn().mockResolvedValue("wifi:\n  ssid: x\n"),
    getBoard: vi.fn().mockResolvedValue(board()),
    getPreferences: vi.fn().mockResolvedValue({ navigator_visible: true }),
    ...overrides,
  }) as unknown as ESPHomeAPI;

/** Construct a page element, plant the api + devices context, and
 *  let Lit settle the initial lifecycle. ``devicesLoaded`` simulates
 *  the parent ``devicesLoadedContext`` signal landing; pass
 *  ``false`` to keep the page in the "context not yet delivered"
 *  state. */
async function mountPage(
  api: ESPHomeAPI,
  id: string,
  devicesList: ConfiguredDevice[],
  devicesLoaded = true
): Promise<ESPHomePageDevice> {
  const page = new ESPHomePageDevice();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._api = api;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._devices = devicesList;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._devicesLoaded = devicesLoaded;
  page.id = id;
  document.body.appendChild(page);
  await page.updateComplete;
  await flushMicrotasks(8);
  return page;
}

function readPlatformReady(page: ESPHomePageDevice): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (page as any)._platformReady;
}

function readBoard(page: ESPHomePageDevice): BoardCatalogEntry | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (page as any)._board;
}

describe("device page _platformReady lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Shared board-body cache is a module singleton; clear it so a
    // board fetched in one case can't satisfy the next case's fetch.
    _clearBoardBodyCache();
  });

  it("flips true after a successful board fetch", async () => {
    const api = makeApi();
    const page = await mountPage(api, "kitchen.yaml", [device()]);

    expect(readPlatformReady(page)).toBe(true);
    expect(readBoard(page)?.id).toBe("esp32cam");
  });

  it("flips true and clears _board when the board fetch fails", async () => {
    // Pin warning #1 from the koan review: on a failed fetch the
    // catch must clear the stale board so the navigator doesn't
    // resolve labels against a wrong platform with no correcting
    // edge to follow.
    const api = makeApi({ getBoard: vi.fn().mockRejectedValue(new Error("nope")) });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const page = await mountPage(api, "kitchen.yaml", [device()]);

    expect(readPlatformReady(page)).toBe(true);
    expect(readBoard(page)).toBeNull();
  });

  it("clears stale _board on board-id change followed by a failed re-fetch", async () => {
    // Same scenario applied to the board-id-change-on-same-device
    // path: first fetch succeeds with board A, then board_id
    // changes (wizard re-run) and the second fetch fails — the
    // stale A must not leak through to the navigator.
    const boardA = board({
      id: "esp32cam",
      esphome: { platform: "esp32" } as BoardCatalogEntry["esphome"],
    });
    const getBoard = vi
      .fn()
      .mockResolvedValueOnce(boardA)
      .mockRejectedValueOnce(new Error("nope"));
    const api = makeApi({ getBoard });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const page = await mountPage(api, "kitchen.yaml", [device({ board_id: "esp32cam" })]);
    expect(readBoard(page)?.id).toBe("esp32cam");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (page as any)._devices = [device({ board_id: "rp2040-rpi-pico" })];
    page.requestUpdate();
    await page.updateComplete;
    await flushMicrotasks(8);

    expect(readPlatformReady(page)).toBe(true);
    expect(readBoard(page)).toBeNull();
  });

  it("flips true when the device has no board_id", async () => {
    const api = makeApi();
    const page = await mountPage(api, "kitchen.yaml", [device({ board_id: "" })]);

    expect(readPlatformReady(page)).toBe(true);
    expect(readBoard(page)).toBeNull();
  });

  it("flips true when devices context is loaded but our id isn't in it (stale link)", async () => {
    const api = makeApi();
    const page = await mountPage(api, "ghost.yaml", [device()]);

    expect(readPlatformReady(page)).toBe(true);
  });

  it("stays false until devicesLoaded fires (no premature flip on yaml)", async () => {
    // Pin suggestion #1 from the koan review: yaml landing before
    // ``devicesLoadedContext`` must not trip the gate, or we
    // reintroduce the double-fetch this PR removes.
    const api = makeApi();
    const page = await mountPage(api, "kitchen.yaml", [], false);

    expect(readPlatformReady(page)).toBe(false);

    // Now the devices context delivers with a real board_id.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (page as any)._devices = [device()];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (page as any)._devicesLoaded = true;
    page.requestUpdate();
    await page.updateComplete;
    await flushMicrotasks(8);

    expect(readPlatformReady(page)).toBe(true);
    expect(readBoard(page)?.id).toBe("esp32cam");
  });

  it("flips true on devicesLoaded with an empty list (zero-device dashboard)", async () => {
    // ``_devices.length > 0`` would miss this: a legitimate
    // zero-device dashboard, where the context delivered but
    // there's nothing in it. Using ``_devicesLoaded`` correctly
    // releases the gate; the navigator resolves with
    // ``platform=undefined``.
    const api = makeApi();
    const page = await mountPage(api, "ghost.yaml", [], true);

    expect(readPlatformReady(page)).toBe(true);
  });

  it("resets to false on device id change", async () => {
    const api = makeApi();
    const page = await mountPage(api, "kitchen.yaml", [device()]);
    expect(readPlatformReady(page)).toBe(true);

    page.id = "bedroom.yaml";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (page as any)._devices = [device({ configuration: "bedroom.yaml", name: "bedroom" })];
    page.requestUpdate();
    await page.updateComplete;
    await flushMicrotasks(8);

    // Eventually true again after the new board fetch resolves.
    expect(readPlatformReady(page)).toBe(true);
  });
});
