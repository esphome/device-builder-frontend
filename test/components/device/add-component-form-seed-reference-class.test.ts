import { afterEach, describe, expect, it } from "vitest";
import { identityLocalize } from "../../_dom.js";
import type { ESPHomeAPI } from "../../../src/api/index.js";
import type { ComponentCatalogIndexEntry } from "../../../src/api/types/components.js";
import { seedDefaults } from "../../../src/components/device/add-component-form-seed.js";
import {
  _clearCatalogCache,
  loadCatalog,
} from "../../../src/util/yaml-completion-catalog.js";
import { makeComponentEntry } from "../../util/_make-component-entry.js";
import { makeConfigEntry } from "../../util/_make-config-entry.js";

const apiWith = (components: ComponentCatalogIndexEntry[]) =>
  ({
    getComponents: async () => ({ components, total: components.length }),
  }) as unknown as ESPHomeAPI;

describe("seedDefaults with a class-restricted reference", () => {
  afterEach(() => _clearCatalogCache());

  const entries = [
    makeConfigEntry({
      key: "modbus_id",
      required: true,
      references_component: "modbus",
      references_class: "modbus::ModbusServerHub",
    }),
  ];
  const CLIENT_ONLY = "modbus:\n  - id: client_hub\n";
  const hub = makeComponentEntry("modbus", {
    id_classes: ["modbus::ModbusClientHub"],
    id_classes_by_variant: {
      role: {
        client: ["modbus::ModbusClientHub"],
        server: ["modbus::ModbusServerHub"],
      },
    },
  });

  it("does not auto-pick the only hub when it is the wrong variant", async () => {
    await loadCatalog(apiWith([hub]));
    expect(seedDefaults(entries, CLIENT_ONLY, identityLocalize)).toEqual({});
  });

  it("auto-picks the sole hub of the right variant", async () => {
    await loadCatalog(apiWith([hub]));
    const yaml = `${CLIENT_ONLY}  - id: server_hub\n    role: server\n`;
    expect(seedDefaults(entries, yaml, identityLocalize)).toEqual({
      modbus_id: "server_hub",
    });
  });
});
