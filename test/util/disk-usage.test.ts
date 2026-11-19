import { describe, expect, it } from "vitest";

import type { DiskUsage } from "../../src/api/types/system.js";
import {
  diskSegments,
  isDiskSpaceLow,
  percentOf,
  toolchainAndCacheBytes,
} from "../../src/util/disk-usage.js";

const GB = 1024 ** 3;

function usage(over: Partial<DiskUsage> = {}): DiskUsage {
  return {
    total_bytes: 100 * GB,
    free_bytes: 40 * GB,
    builds_bytes: 2 * GB,
    remote_builds_bytes: 0,
    toolchains_bytes: 4 * GB,
    cache_bytes: 1 * GB,
    config_bytes: 1024 ** 2,
    measured_at: 1,
    ...over,
  };
}

describe("isDiskSpaceLow", () => {
  it("is false before the first measurement", () => {
    expect(isDiskSpaceLow(null)).toBe(false);
  });

  it("warns under 10% free on a large volume", () => {
    expect(isDiskSpaceLow(usage({ free_bytes: 10 * GB }))).toBe(false);
    expect(isDiskSpaceLow(usage({ free_bytes: 9.9 * GB }))).toBe(true);
  });

  it("warns under 5 GB free on a small volume, where 10% would be too little", () => {
    expect(isDiskSpaceLow(usage({ total_bytes: 32 * GB, free_bytes: 5 * GB }))).toBe(
      false
    );
    expect(isDiskSpaceLow(usage({ total_bytes: 32 * GB, free_bytes: 4.9 * GB }))).toBe(
      true
    );
  });

  it("ignores an unreadable volume", () => {
    expect(isDiskSpaceLow(usage({ total_bytes: 0, free_bytes: 0 }))).toBe(false);
  });
});

describe("diskSegments", () => {
  it("lists ESPHome's slices then everything else, merging toolchains and caches", () => {
    expect(diskSegments(usage())).toEqual([
      { key: "builds", bytes: 2 * GB },
      { key: "toolchains", bytes: 5 * GB },
      { key: "config", bytes: 1024 ** 2 },
      { key: "other", bytes: 60 * GB - 7 * GB - 1024 ** 2 },
    ]);
  });

  it("drops empty slices and never reports negative other", () => {
    const keys = diskSegments(usage({ free_bytes: 99 * GB })).map((s) => s.key);
    expect(keys).toEqual(["builds", "toolchains", "config"]);
  });
});

describe("helpers", () => {
  it("sums what Reset build environment frees", () => {
    expect(toolchainAndCacheBytes(usage())).toBe(5 * GB);
  });

  it("computes a bar width", () => {
    expect(percentOf(25, 100)).toBe(25);
    expect(percentOf(5, 0)).toBe(0);
  });
});
