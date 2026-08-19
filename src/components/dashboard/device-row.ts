import type { ConfiguredDevice, Label } from "../../api/types/devices.js";
import type { DeviceState } from "../../api/types/devices.js";
import type { FirmwareJob } from "../../api/types/firmware-jobs.js";

/** One row of the device table, derived from a ``ConfiguredDevice``
 *  by ``device-table``'s ``willUpdate``. Lives in its own leaf module
 *  so ``table-columns`` and ``table-features`` can both depend on it
 *  without importing each other. */
export interface DeviceRow {
  status: DeviceState;
  name: string;
  friendly_name: string;
  address: string;
  ip: string;
  ip_addresses: string[];
  mac_address: string;
  platform: string;
  version: string;
  comment: string;
  area: string;
  /** Resolved label objects (catalog joined against
   *  ``device.labels``) so the cell renderer doesn't need access to
   *  the catalog itself. ``device-table`` performs the resolve when
   *  building rows. */
  labels: Label[];
  config: string;
  build_size_bytes: number;
  // Raw has_pending_changes (device truth) — drives the encryption lock only.
  hasPendingChanges: boolean;
  // mDNS-gated display flags (see util/device-sync.ts): modified dot + install
  // button, update column + update button.
  showModified: boolean;
  showUpdate: boolean;
  hasQueuedUpdate: boolean;
  api_enabled: boolean;
  api_encrypted: boolean;
  api_encryption_active: string | null;
  busy: boolean;
  recentJob: FirmwareJob | null;
  _device: ConfiguredDevice;
}
