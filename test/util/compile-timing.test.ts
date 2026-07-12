import { describe, expect, it } from "vitest";
import {
  getCompileTiming,
  markCompileEnded,
  markCompileStarted,
} from "../../src/util/compile-timing.js";

describe("compile-timing store", () => {
  it("records the start and reads it back", () => {
    markCompileStarted("job-a", 1000);
    expect(getCompileTiming("job-a")).toEqual({ startedAt: 1000, endedAt: null });
  });

  it("keeps the first start for a job (idempotent on reattach)", () => {
    markCompileStarted("job-b", 1000);
    markCompileStarted("job-b", 5000);
    expect(getCompileTiming("job-b")?.startedAt).toBe(1000);
  });

  it("freezes the end once", () => {
    markCompileStarted("job-c", 1000);
    markCompileEnded("job-c", 2000);
    markCompileEnded("job-c", 9000);
    expect(getCompileTiming("job-c")).toEqual({ startedAt: 1000, endedAt: 2000 });
  });

  it("ignores an empty job id and returns null for unknown jobs", () => {
    markCompileStarted("", 1000);
    expect(getCompileTiming("")).toBeNull();
    expect(getCompileTiming("never-seen")).toBeNull();
  });

  it("does not end a job it never started", () => {
    markCompileEnded("job-d", 2000);
    expect(getCompileTiming("job-d")).toBeNull();
  });
});
