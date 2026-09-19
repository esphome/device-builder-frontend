/**
 * Build a ConfigEntry from its three guaranteed fields plus overrides. Every
 * other field is optional on the wire, so a synthesised entry stays as slim
 * as one the backend sends.
 */
import { type ConfigEntry, ConfigEntryType } from "../api/types/config-entries.js";

export function makeConfigEntry(overrides: Partial<ConfigEntry> = {}): ConfigEntry {
  return { key: "", type: ConfigEntryType.STRING, label: "", ...overrides };
}
