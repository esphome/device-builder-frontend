/**
 * Decide whether to nudge a device toward `ota: encryption:`. Once the
 * block is in the YAML the CLI never falls back to plaintext, so the
 * nudge fires only when the device itself reports Noise on the api over
 * mDNS and runs released 2026.9.0 or newer, the firmware that offers OTA
 * encryption with that key.
 */
import type { ConfiguredDevice } from "../api/types/devices.js";
import { deployedIdentityTrusted } from "./device-sync.js";
import {
  firmwareOffersOtaEncryption,
  toolchainAcceptsOtaEncryption,
} from "./esphome-version.js";
import { hasStaticApiKey, otaEsphomeFacts } from "./yaml-ota-encryption.js";

/** `add` when the item has neither password nor encryption, `replace_password`
 *  when it still carries a password, `drop_own_key` when the block carries its
 *  own key next to a static api key (the device encrypts OTA with the api key,
 *  so the extra key is only a second copy to keep identical). */
export type OtaEncryptionNudge = "add" | "replace_password" | "drop_own_key";

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
  const facts = otaEsphomeFacts(yaml);
  if (!facts.present || !facts.rewritable || !hasStaticApiKey(yaml)) return null;
  // A redundant own key is a config shape, not a firmware capability, so no
  // device gate and no key comparison: with a static api key esphome builds the
  // OTA transport from that key and ignores the OTA `key:` (ota/__init__.py
  // to_code, own key only without a static api key), and its validation
  // rejects a differing pair (_resolve_encryption_key), so the running firmware
  // never holds the OTA `key:` and dropping it cannot change what it requires.
  if (facts.hasEncryption) return facts.hasOwnKey ? "drop_own_key" : null;
  if (!device || !deviceOffersOtaEncryption(device)) return null;
  if (!toolchainAcceptsOtaEncryption(esphomeVersion)) return null;
  return facts.hasPassword ? "replace_password" : "add";
}

/** The device's mDNS TXT reports Noise active on the api and a released 2026.9.0+
 *  version, behind the trust gate so a sidecar-seeded value from a past session
 *  does not count as the device reporting it now. */
function deviceOffersOtaEncryption(device: ConfiguredDevice): boolean {
  const rt = device.runtime_state;
  return (
    deployedIdentityTrusted(device) &&
    !!rt.api_encryption_active &&
    firmwareOffersOtaEncryption(rt.deployed_version)
  );
}
