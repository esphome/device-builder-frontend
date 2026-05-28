import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  onSetOffloaderAllowMajorVersionMismatch,
  onSetOffloaderRemoteBuildsEnabled,
} from "../../../src/components/app-shell/settings-actions.js";
import type { ESPHomeApp } from "../../../src/components/app-shell.js";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner-js", () => ({
  default: {
    error: (...args: unknown[]) => toastError(...args),
  },
}));

type StubHost = Pick<
  ESPHomeApp,
  | "_offloaderAllowMajorVersionMismatch"
  | "_offloaderRemoteBuildsEnabled"
  | "_offloaderSettingsInFlightCount"
  | "_localize"
> & {
  _api: {
    setOffloaderRemoteBuildSettings: (args: Record<string, boolean>) => Promise<unknown>;
  };
};

function makeHost(api: StubHost["_api"]): StubHost {
  return {
    _offloaderAllowMajorVersionMismatch: true,
    _offloaderRemoteBuildsEnabled: true,
    _offloaderSettingsInFlightCount: 0,
    _localize: ((key: string) => key) as ESPHomeApp["_localize"],
    _api: api,
  };
}

describe("onSetOffloaderAllowMajorVersionMismatch", () => {
  beforeEach(() => {
    toastError.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("optimistically flips, sends the API call, clears the in-flight flag", async () => {
    let inFlightDuringCall = false;
    const setApi = vi.fn(async (_args: Record<string, boolean>) => {
      inFlightDuringCall = host._offloaderSettingsInFlightCount > 0;
      return {};
    });
    const host = makeHost({ setOffloaderRemoteBuildSettings: setApi });

    await onSetOffloaderAllowMajorVersionMismatch(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: false })
    );

    expect(setApi).toHaveBeenCalledWith({ allow_major_version_mismatch: false });
    expect(host._offloaderAllowMajorVersionMismatch).toBe(false);
    expect(inFlightDuringCall).toBe(true);
    expect(host._offloaderSettingsInFlightCount).toBe(0);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("reverts to the previous value and toasts on backend rejection", async () => {
    const setApi = vi.fn(async () => {
      throw new Error("backend said no");
    });
    const host = makeHost({ setOffloaderRemoteBuildSettings: setApi });

    await onSetOffloaderAllowMajorVersionMismatch(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: false })
    );

    expect(host._offloaderAllowMajorVersionMismatch).toBe(true);
    expect(toastError).toHaveBeenCalledOnce();
    expect(host._offloaderSettingsInFlightCount).toBe(0);
  });
});

describe("onSetOffloaderRemoteBuildsEnabled in-flight guard", () => {
  beforeEach(() => {
    toastError.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets the offloader-settings in-flight flag for the duration of the API call", async () => {
    let inFlightDuringCall = false;
    const setApi = vi.fn(async () => {
      inFlightDuringCall = host._offloaderSettingsInFlightCount > 0;
      return {};
    });
    const host = makeHost({ setOffloaderRemoteBuildSettings: setApi });

    await onSetOffloaderRemoteBuildsEnabled(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: false })
    );

    expect(inFlightDuringCall).toBe(true);
    expect(host._offloaderSettingsInFlightCount).toBe(0);
  });

  it("keeps the in-flight count above zero across overlapping concurrent writes", async () => {
    let release1!: () => void;
    let release2!: () => void;
    const pending1 = new Promise<void>((r) => (release1 = r));
    const pending2 = new Promise<void>((r) => (release2 = r));
    let call = 0;
    const setApi = vi.fn(async () => {
      call += 1;
      await (call === 1 ? pending1 : pending2);
      return {};
    });
    const host = makeHost({ setOffloaderRemoteBuildSettings: setApi });

    const first = onSetOffloaderRemoteBuildsEnabled(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: false })
    );
    const second = onSetOffloaderAllowMajorVersionMismatch(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: false })
    );
    expect(host._offloaderSettingsInFlightCount).toBe(2);

    release1();
    await first;
    expect(host._offloaderSettingsInFlightCount).toBe(1);

    release2();
    await second;
    expect(host._offloaderSettingsInFlightCount).toBe(0);
  });
});
