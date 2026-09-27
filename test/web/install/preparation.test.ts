import { describe, expect, it, vi } from "vitest";

import { fakeHost } from "../../_fake-host.js";
import {
  parseFailureCopy,
  Preparation,
  type Prepared,
} from "../../../src/web/install/preparation.js";

function make(prepare: (input: string) => Promise<Prepared<string, string>>) {
  const host = fakeHost();
  const settled = vi.fn();
  return { preparation: new Preparation(host, prepare, settled, String), host, settled };
}

const done = (preparation: Preparation<string, string, string>) =>
  vi.waitFor(() => expect(preparation.state.kind).not.toBe("pending"));

describe("Preparation", () => {
  it("is pending while the input is prepared, then ready with its value", async () => {
    const { preparation, host, settled } = make(async (input) => ({
      value: `parsed ${input}`,
    }));
    preparation.start("a");
    expect(preparation.state).toEqual({ kind: "pending" });
    await done(preparation);
    expect(preparation.state).toEqual({ kind: "ready", value: "parsed a" });
    expect(host.requestUpdate).toHaveBeenCalledTimes(2);
    expect(settled).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("drops an input that failed, and says why", async () => {
    const { preparation, settled } = make(async () => ({
      failure: "not firmware",
      retryable: false,
    }));
    preparation.start("a");
    await done(preparation);
    expect(preparation.state).toEqual({ kind: "idle" });
    expect(settled).toHaveBeenCalledExactlyOnceWith("not firmware");
    // Nothing is kept to try again.
    preparation.retry();
    expect(preparation.state).toEqual({ kind: "idle" });
  });

  it("drops an input whose preparation rejected, and says why", async () => {
    const { preparation, settled } = make(() => Promise.reject("revoked"));
    preparation.start("a");
    await done(preparation);
    expect(preparation.state).toEqual({ kind: "idle" });
    expect(settled).toHaveBeenCalledExactlyOnceWith("revoked");
  });

  it("keeps an input a chunk failed to load for, and prepares it again", async () => {
    const prepare = vi
      .fn<(input: string) => Promise<Prepared<string, string>>>()
      .mockResolvedValueOnce({ failure: "offline", retryable: true })
      .mockResolvedValueOnce({ value: "parsed" });
    const { preparation, settled } = make(prepare);
    preparation.start("a");
    await done(preparation);
    expect(preparation.state).toEqual({ kind: "retryable", input: "a" });
    preparation.retry();
    await done(preparation);
    expect(preparation.state).toEqual({ kind: "ready", value: "parsed" });
    expect(prepare).toHaveBeenNthCalledWith(2, "a");
    expect(settled.mock.calls).toEqual([["offline"], [null]]);
  });

  it("ignores a preparation that a newer input or a clear overtook", async () => {
    const release: Array<(result: Prepared<string, string>) => void> = [];
    const { preparation, settled } = make(
      () => new Promise((resolve) => release.push(resolve))
    );
    preparation.start("old");
    preparation.start("new");
    release[1]({ value: "new" });
    await done(preparation);
    release[0]({ value: "old" });
    await Promise.resolve();
    expect(preparation.state).toEqual({ kind: "ready", value: "new" });
    expect(settled).toHaveBeenCalledOnce();

    preparation.start("late");
    preparation.clear();
    release[2]({ failure: "late", retryable: true });
    await Promise.resolve();
    expect(preparation.state).toEqual({ kind: "idle" });
    expect(settled).toHaveBeenCalledOnce();
  });
});

describe("parseFailureCopy", () => {
  it("offers a retry for tools that did not load, without sending to a reload", () => {
    expect(parseFailureCopy("firmware.engine_load_failed")).toEqual({
      key: "web.install.tools_load_failed",
      retryable: true,
    });
  });

  it("keeps the line of a file that is not firmware, which no retry helps", () => {
    expect(parseFailureCopy("firmware.rtl_bad_uf2")).toEqual({
      key: "firmware.rtl_bad_uf2",
      retryable: false,
    });
  });
});
