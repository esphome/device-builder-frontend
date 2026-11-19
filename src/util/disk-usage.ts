import type { DiskUsage } from "../api/types/system.js";

const GB = 1024 ** 3;

/** One slice of the disk bar; `key` doubles as the CSS modifier and the label suffix. */
export interface DiskSegment {
  key: "builds" | "toolchains" | "remote_builds" | "config" | "other";
  bytes: number;
}

/**
 * Whether free space is low enough that builds risk failing: under 5 GB or
 * under 10% of the volume, whichever is larger. A single fixed rule, no setting.
 */
export function isDiskSpaceLow(usage: DiskUsage | null): boolean {
  if (usage === null || usage.total_bytes <= 0) return false;
  return usage.free_bytes < Math.max(5 * GB, usage.total_bytes * 0.1);
}

/** Bytes Reset build environment frees: the toolchains plus the data-dir caches. */
export function toolchainAndCacheBytes(usage: DiskUsage): number {
  return usage.toolchains_bytes + usage.cache_bytes;
}

/**
 * Used-space slices for the disk bar, in display order. `other` is whatever
 * else uses the volume; zero-byte slices are dropped.
 */
export function diskSegments(usage: DiskUsage): DiskSegment[] {
  const esphome: DiskSegment[] = [
    { key: "builds", bytes: usage.builds_bytes },
    { key: "toolchains", bytes: toolchainAndCacheBytes(usage) },
    { key: "remote_builds", bytes: usage.remote_builds_bytes },
    { key: "config", bytes: usage.config_bytes },
  ];
  const ours = esphome.reduce((sum, s) => sum + s.bytes, 0);
  const used = Math.max(0, usage.total_bytes - usage.free_bytes);
  const other: DiskSegment = { key: "other", bytes: Math.max(0, used - ours) };
  return [...esphome, other].filter((s) => s.bytes > 0);
}

/** `bytes` as a percentage of `total`, for a bar width; 0 for an empty volume. */
export function percentOf(bytes: number, total: number): number {
  return total > 0 ? (bytes / total) * 100 : 0;
}
