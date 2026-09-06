/**
 * Decide whether to nudge a device toward `ota: encryption:`. Once the
 * block is in the YAML the CLI never falls back to plaintext, so the
 * nudge fires only when the device itself reports Noise on the api over
 * mDNS and runs released 2026.9.0 or newer, the firmware that offers OTA
 * encryption with that key.
 */
import type { ConfiguredDevice } from "../api/types/devices.js";
import {
  firmwareOffersOtaEncryption,
  toolchainAcceptsOtaEncryption,
} from "./esphome-version.js";
import { hasStaticApiKey, otaEsphomeFacts } from "./yaml-ota-encryption.js";

/** `add` when the item has neither password nor encryption, `replace_password`
 *  when it still carries a password. */
export type OtaEncryptionNudge = "add" | "replace_password";

export interface OtaEncryptionNudgeInputs {
  device: ConfiguredDevice | undefined;
  /** The page's draft buffer. */
  yaml: string;
  /** The dashboard's bundled esphome version. */
  esphomeVersion: string;
}

export function otaEncryptionNudge({
  device,
  yaml,
  esphomeVersion,
}: OtaEncryptionNudgeInputs): OtaEncryptionNudge | null {
  if (!device || !deviceOffersOtaEncryption(device)) return null;
  if (!toolchainAcceptsOtaEncryption(esphomeVersion)) return null;
  if (!hasStaticApiKey(yaml)) return null;
  const facts = otaEsphomeFacts(yaml);
  if (!facts.present || facts.hasEncryption) return null;
  return facts.hasPassword ? "replace_password" : "add";
}

/** The device's mDNS TXT reports Noise active on the api and a released 2026.9.0+ version. */
export function deviceOffersOtaEncryption(device: ConfiguredDevice): boolean {
  const rt = device.runtime_state;
  return !!rt.api_encryption_active && firmwareOffersOtaEncryption(rt.deployed_version);
}
