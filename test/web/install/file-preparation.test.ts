import { describe, expect, it, vi } from "vitest";

import {
  FilePreparation,
  type PreparationFailure,
} from "../../../src/web/install/file-preparation.js";

const file = (name: string) => ({ name }) as File;

function make(prepare: (file: File) => Promise<{ value: string } | PreparationFailure>) {
  const host = {
    requestUpdate: vi.fn(),
    addController: vi.fn(),
    removeController: vi.fn(),
    updateComplete: Promise.resolve(true),
  };
  const failed = vi.fn();
  return {
    preparation: new FilePreparation<string>(host, prepare, failed),
    host,
    failed,
  };
}

const settled = (preparation: FilePreparation<string>) =>
  vi.waitFor(() => expect(preparation.state.kind).not.toBe("pending"));

describe("FilePreparation", () => {
  it("is pending while the file is prepared, then ready with its value", async () => {
    const { preparation, host, failed } = make(async (f) => ({
      value: `parsed ${f.name}`,
    }));
    expect(preparation.file).toBeNull();
    preparation.start(file("a.uf2"));
    expect(preparation.state.kind).toBe("pending");
    expect(preparation.file?.name).toBe("a.uf2");
    await settled(preparation);
    expect(preparation.state).toMatchObject({ kind: "ready", value: "parsed a.uf2" });
    expect(host.requestUpdate).toHaveBeenCalledTimes(2);
    expect(failed).not.toHaveBeenCalled();
  });

  it("reports a failure once and keeps its copy", async () => {
    const failure = { title: "bad file", detail: "not a UF2" };
    const { preparation, failed } = make(async () => failure);
    preparation.start(file("a.uf2"));
    await settled(preparation);
    expect(preparation.state).toMatchObject({ kind: "failed", ...failure });
    expect(failed).toHaveBeenCalledExactlyOnceWith(failure);
  });

  it("drops a file that failed on recovery, and checks one that may be fine again", async () => {
    const prepare = vi
      .fn<(f: File) => Promise<{ value: string } | PreparationFailure>>()
      .mockResolvedValueOnce({ title: "bad", detail: "" });
    const { preparation } = make(prepare);
    preparation.start(file("a.uf2"));
    await settled(preparation);
    preparation.recover();
    expect(preparation.state).toEqual({ kind: "idle" });

    prepare
      .mockResolvedValueOnce({ title: "offline", detail: "", retryable: true })
      .mockResolvedValueOnce({ value: "parsed" });
    preparation.start(file("b.uf2"));
    await settled(preparation);
    preparation.recover();
    await settled(preparation);
    expect(preparation.state).toMatchObject({ kind: "ready", value: "parsed" });
    expect(preparation.file?.name).toBe("b.uf2");
    expect(prepare).toHaveBeenCalledTimes(3);
  });

  it("ignores a preparation that a newer pick or a clear overtook", async () => {
    const release: Array<(result: { value: string }) => void> = [];
    const { preparation, failed } = make(
      () => new Promise((resolve) => release.push(resolve))
    );
    preparation.start(file("old.uf2"));
    preparation.start(file("new.uf2"));
    release[1]({ value: "new" });
    await settled(preparation);
    release[0]({ value: "old" });
    await Promise.resolve();
    expect(preparation.state).toMatchObject({ kind: "ready", value: "new" });

    preparation.start(file("late.uf2"));
    preparation.clear();
    release[2]({ value: "late" });
    await Promise.resolve();
    expect(preparation.state).toEqual({ kind: "idle" });
    expect(failed).not.toHaveBeenCalled();
  });
});
