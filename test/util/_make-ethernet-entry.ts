/** Ethernet-shaped fixture: a ``type`` select plus a ``spi_id`` reference gated on it. */
import type { ComponentCatalogEntry } from "../../src/api/types/components.js";
import { ConfigEntryType } from "../../src/api/types/config-entries.js";
import { makeComponentEntry } from "./_make-component-entry.js";
import { makeConfigEntry } from "./_make-config-entry.js";

export function makeEthernetEntry(
  typeDefault: string | null = null
): ComponentCatalogEntry {
  return makeComponentEntry("ethernet", {
    name: "Ethernet",
    dependencies: ["spi"],
    config_entries: [
      makeConfigEntry({
        key: "type",
        type: ConfigEntryType.SELECT,
        options: [
          { value: "IP101", label: "IP101" },
          { value: "W5500", label: "W5500" },
        ],
        default_value: typeDefault,
      }),
      makeConfigEntry({
        key: "spi_id",
        type: ConfigEntryType.ID,
        references_component: "spi",
        depends_on: "type",
        depends_on_value_any: ["W5500"],
      }),
    ],
  });
}
