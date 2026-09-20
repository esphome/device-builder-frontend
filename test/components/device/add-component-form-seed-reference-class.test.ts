import { describe, expect, it } from "vitest";
import { identityLocalize } from "../../_dom.js";
import { seedDefaults } from "../../../src/components/device/add-component-form-seed.js";
import { makeComponentEntry } from "../../util/_make-component-entry.js";
import { makeConfigEntry } from "../../util/_make-config-entry.js";

describe("seedDefaults with a class-restricted reference", () => {
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

  const byId = new Map([[hub.id, hub]]);

  it("does not auto-pick the only hub when it is the wrong variant", () => {
    expect(seedDefaults(entries, CLIENT_ONLY, identityLocalize, false, byId)).toEqual({});
  });

  it("auto-picks the sole hub of the right variant", () => {
    const yaml = `${CLIENT_ONLY}  - id: server_hub\n    role: server\n`;
    expect(seedDefaults(entries, yaml, identityLocalize, false, byId)).toEqual({
      modbus_id: "server_hub",
    });
  });
});
