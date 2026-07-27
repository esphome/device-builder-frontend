// @vitest-environment happy-dom
/**
 * Pins the initial-YAML loading gate: a slow getConfig shows the
 * spinner panel instead of an empty editor, a failed one shows the
 * retry panel, and Retry recovers into the mounted editor.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import "./_mock-device-children.js";
vi.mock("../../src/components/device/board-reselect-dialog.js", () => ({}));

import { APIError, type ESPHomeAPI } from "../../src/api/index.js";
import { ErrorCode } from "../../src/api/types/protocol.js";
import { ESPHomePageDevice } from "../../src/pages/device.js";
import { flushMicrotasks, mount } from "../_dom.js";

interface Deferred {
  resolve(value: string): void;
  reject(error: Error): void;
  promise: Promise<string>;
}

function makeDeferred(): Deferred {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { resolve, reject, promise };
}

function makeApi(getConfig: ReturnType<typeof vi.fn>): ESPHomeAPI {
  return {
    ready: Promise.resolve(),
    getConfig,
    getPreferences: vi.fn().mockResolvedValue({ navigator_visible: true }),
  } as unknown as ESPHomeAPI;
}

async function mountPage(api: ESPHomeAPI): Promise<ESPHomePageDevice> {
  const page = await mount(new ESPHomePageDevice(), {
    _api: api,
    id: "kitchen.yaml",
  } as Partial<ESPHomePageDevice>);
  await flushMicrotasks(8);
  await page.updateComplete;
  return page;
}

const editorIn = (page: ESPHomePageDevice) =>
  page.shadowRoot!.querySelector("esphome-device-editor");
// renderAsyncState's ladder: a .message block, plus a sibling action
// button on the failure branches.
const loadPanelIn = (page: ESPHomePageDevice) =>
  page.shadowRoot!.querySelector(".message");
const loadActionIn = (page: ESPHomePageDevice) =>
  page.shadowRoot!.querySelector(".message ~ wa-button");

describe("device page initial YAML loading gate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the loading panel instead of an empty editor while getConfig is in flight", async () => {
    const deferred = makeDeferred();
    const page = await mountPage(makeApi(vi.fn().mockReturnValue(deferred.promise)));

    expect(editorIn(page)).toBeNull();
    const panel = loadPanelIn(page);
    expect(panel).not.toBeNull();
    expect(panel!.querySelector("wa-spinner")).not.toBeNull();

    deferred.resolve("wifi:\n  ssid: x\n");
    await flushMicrotasks(8);
    await page.updateComplete;

    expect(loadPanelIn(page)).toBeNull();
    const editor = editorIn(page);
    expect(editor).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((editor as any).yaml).toBe("wifi:\n  ssid: x\n");
  });

  it("clears the prior device's buffer on an id change", async () => {
    const getConfig = vi
      .fn()
      .mockResolvedValueOnce("esphome:\n  name: kitchen\n")
      .mockImplementationOnce(() => new Promise<string>(() => {}));
    const page = await mountPage(makeApi(getConfig));
    const view = page as unknown as { _yaml: string; _savedYaml: string };
    expect(view._yaml).toBe("esphome:\n  name: kitchen\n");

    // Discard leaves the buffer dirty; the element is then reused for
    // the next device, whose load hangs.
    view._yaml = "esphome:\n  name: kitchen-edited\n";
    page.id = "porch.yaml";
    await page.updateComplete;

    // The prior device's dirty YAML must not survive where Save could
    // write it into porch.yaml.
    expect(view._yaml).toBe("");
    expect(view._savedYaml).toBe("");
  });

  it("keeps the spinner and retries when the socket drops mid-fetch", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      // A dropped socket rejects every in-flight request at once, so this
      // arrives in milliseconds — the panel must not flash for it.
      const getConfig = vi
        .fn()
        .mockRejectedValueOnce(new Error("WebSocket connection closed"))
        .mockResolvedValueOnce("wifi:\n  ssid: x\n");
      const page = await mountPage(makeApi(getConfig));

      const panel = loadPanelIn(page);
      expect(panel).not.toBeNull();
      expect(panel!.querySelector("wa-spinner")).not.toBeNull();
      expect(loadActionIn(page)).toBeNull();

      await vi.advanceTimersByTimeAsync(1500);
      await flushMicrotasks(8);
      await page.updateComplete;

      expect(getConfig).toHaveBeenCalledTimes(2);
      expect(loadPanelIn(page)).toBeNull();
      expect(editorIn(page)).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the retry panel once the transport attempts are spent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      const getConfig = vi
        .fn()
        .mockRejectedValue(new Error("WebSocket connection closed"));
      const page = await mountPage(makeApi(getConfig));

      await vi.advanceTimersByTimeAsync(1500 * 4);
      await flushMicrotasks(8);
      await page.updateComplete;

      expect(getConfig).toHaveBeenCalledTimes(4);
      const panel = loadPanelIn(page);
      expect(panel!.querySelector("wa-spinner")).toBeNull();
      expect(panel!.textContent).toContain("device.load_failed");

      // Retry re-arms the whole recovery loop from scratch.
      getConfig.mockResolvedValueOnce("wifi:\n  ssid: x\n");
      (loadActionIn(page) as HTMLElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
      await flushMicrotasks(8);
      await page.updateComplete;

      expect(editorIn(page)).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces a server-side failure without burning retries", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const getConfig = vi
      .fn()
      .mockRejectedValue(new APIError(ErrorCode.INTERNAL_ERROR, "boom"));
    const page = await mountPage(makeApi(getConfig));

    // The server answered, so retrying the same request is pointless.
    expect(getConfig).toHaveBeenCalledTimes(1);
    expect(loadPanelIn(page)!.textContent).toContain("device.load_failed");
  });

  it("offers a way back instead of a retry when the config is gone", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const getConfig = vi
      .fn()
      .mockRejectedValue(new APIError(ErrorCode.NOT_FOUND, "no such device"));
    const page = await mountPage(makeApi(getConfig));

    const panel = loadPanelIn(page);
    expect(panel).not.toBeNull();
    // A deleted config can't be retried into existence.
    expect(panel!.textContent).toContain("device.load_not_found");
    const button = loadActionIn(page);
    expect(button!.textContent).toContain("device.back_to_dashboard");

    (button as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushMicrotasks(4);

    expect(getConfig).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/");
  });

  it("retries on its own when the socket comes back", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      const getConfig = vi
        .fn()
        .mockRejectedValue(new Error("WebSocket connection closed"));
      const page = await mountPage(makeApi(getConfig));
      await vi.advanceTimersByTimeAsync(1500 * 4);
      await flushMicrotasks(8);
      await page.updateComplete;
      expect(loadPanelIn(page)!.textContent).toContain("device.load_failed");

      getConfig.mockResolvedValueOnce("wifi:\n  ssid: x\n");
      // The shell provides this through context; the false→true edge is
      // the signal that the socket is usable again.
      (page as unknown as { _apiConnected: boolean })._apiConnected = true;
      page.requestUpdate();
      await flushMicrotasks(8);
      await page.updateComplete;

      // No click needed: the shell said the socket is usable again.
      expect(editorIn(page)).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for api.ready before fetching the config", async () => {
    let releaseReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      releaseReady = resolve;
    });
    const getConfig = vi.fn().mockResolvedValue("wifi:\n  ssid: x\n");
    const api = {
      ready,
      getConfig,
      getPreferences: vi.fn().mockResolvedValue({ navigator_visible: true }),
    } as unknown as ESPHomeAPI;
    const page = await mountPage(api);

    expect(getConfig).not.toHaveBeenCalled();
    expect(loadPanelIn(page)).not.toBeNull();

    releaseReady();
    await flushMicrotasks(8);
    await page.updateComplete;

    // The initial fetch carries its own longer bound, not the 10s default.
    expect(getConfig).toHaveBeenCalledWith("kitchen.yaml", 30_000);
    expect(editorIn(page)).not.toBeNull();
  });
});
