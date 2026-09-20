import { describe, expect, it } from "vitest";
import { identityLocalize } from "../../_dom.js";
import {
  buildInitialValues,
  seedDefaults,
} from "../../../src/components/device/add-component-form-seed.js";
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

  it("does not prefill a detour's newly added block of the wrong class", () => {
    const component = makeComponentEntry("hoermann_hcp", { config_entries: entries });
    const seed = (id: string, yaml: string, catalogById: typeof byId | null = byId) =>
      buildInitialValues({
        entries,
        component,
        board: null,
        yaml,
        prefillReference: { domain: "modbus", id },
        prefillFields: null,
        restoredValues: null,
        localize: identityLocalize,
        catalogById,
      });
    // Two server hubs leave the field unseeded, so the prefill decides.
    const servers = "modbus:\n  - id: a\n    role: server\n  - id: b\n    role: server\n";
    expect(seed("new_client", `${servers}  - id: new_client\n`)).toEqual({});
    expect(
      seed("new_server", `${servers}  - id: new_server\n    role: server\n`)
    ).toEqual({
      modbus_id: "new_server",
    });
    // With no index the new block can't be judged, so the field stays unset.
    expect(
      seed("new_server", `${servers}  - id: new_server\n    role: server\n`, null)
    ).toEqual({});
  });

  it("leaves a class-restricted field unseeded while the index is missing", () => {
    expect(seedDefaults(entries, CLIENT_ONLY, identityLocalize)).toEqual({});
    // A reference with no class keeps the sole-candidate pick.
    const plain = [{ ...entries[0], references_class: null }];
    expect(seedDefaults(plain, CLIENT_ONLY, identityLocalize)).toEqual({
      modbus_id: "client_hub",
    });
  });

  it("auto-picks the sole hub of the right variant", () => {
    const yaml = `${CLIENT_ONLY}  - id: server_hub\n    role: server\n`;
    expect(seedDefaults(entries, yaml, identityLocalize, false, byId)).toEqual({
      modbus_id: "server_hub",
    });
  });
});
