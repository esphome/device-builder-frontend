/** Decide whether to nudge a device toward `ota: encryption:`. */
import type { ConfiguredDevice } from "../api/types/devices.js";
import { deployedIdentityTrusted } from "./device-sync.js";
import {
  firmwareOffersOtaEncryption,
  toolchainAcceptsOtaEncryption,
} from "./esphome-version.js";
import { hasStaticApiKey, otaEsphomeFacts } from "./yaml-ota-encryption.js";

/** `add`: no password or encryption; `replace_password`: a password is set;
 *  `drop_own_key`: an own OTA key next to a static api key. */
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
  // No device gate or key comparison: with a static api key the firmware
  // encrypts OTA with that key and never holds the OTA `key:`.
  if (facts.hasEncryption) return facts.hasOwnKey ? "drop_own_key" : null;
  if (!device || !deviceOffersOtaEncryption(device)) return null;
  if (!toolchainAcceptsOtaEncryption(esphomeVersion)) return null;
  return facts.hasPassword ? "replace_password" : "add";
}

/** Trusted mDNS evidence of Noise on the api and a released 2026.9.0+ version.
 *  No pending-changes gate by design; key rotation is esphome/backlog#161. */
function deviceOffersOtaEncryption(device: ConfiguredDevice): boolean {
  const rt = device.runtime_state;
  return (
    deployedIdentityTrusted(device) &&
    !!rt.api_encryption_active &&
    firmwareOffersOtaEncryption(rt.deployed_version)
  );
}
