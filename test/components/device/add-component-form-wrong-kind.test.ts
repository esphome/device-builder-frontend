/**
 * @vitest-environment happy-dom
 *
 * Pins the form's wrong-kind dependency verdict: a dependency configured only
 * as a block of the wrong id class holds Add behind its own copy, a matching
 * block clears it, and a provider's id counts as a candidate.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
// The shared inner form drags in the full WebAwesome control set, which
// happy-dom can't render; the assertions read the host form's banner and
// submit gate, so an inert unknown element suffices.
vi.mock("../../../src/components/device/config-entry-form.js", () => ({}));

import type { ESPHomeAPI } from "../../../src/api/index.js";
import type { ComponentCatalogEntry } from "../../../src/api/types/components.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { _clearComponentCache } from "../../../src/util/component-name-cache.js";
import { _clearProvidesCache } from "../../../src/util/provides-cache.js";
import {
  _clearCatalogCache,
  loadCatalog,
} from "../../../src/util/yaml-completion-catalog.js";
import { _clearYamlSectionsMemo } from "../../../src/util/yaml-sections-core.js";
import { makeComponentEntry } from "../../util/_make-component-entry.js";
import { makeConfigEntry } from "../../util/_make-config-entry.js";
import {
  depsBanner,
  mountAddComponentForm,
  submitButton,
} from "./_add-component-form-host.js";

const cover = makeComponentEntry("hoermann_hcp", {
  name: "Hörmann",
  dependencies: ["modbus"],
  config_entries: [
    makeConfigEntry({
      key: "modbus_id",
      type: ConfigEntryType.ID,
      references_component: "modbus",
      references_class: "modbus::ModbusServerHub",
    }),
  ],
});

const CATALOG: Partial<ComponentCatalogEntry>[] = [
  { id: "hoermann_hcp" },
  { id: "modbus_bridge", provides: ["modbus"] },
  {
    id: "modbus",
    id_classes: ["modbus::ModbusClientHub"],
    id_classes_by_variant: {
      role: {
        client: ["modbus::ModbusClientHub"],
        server: ["modbus::ModbusServerHub"],
      },
    },
  },
];

/** Serves the loadCatalog sweep and the modbus `provides` query. */
function makeApi(): ESPHomeAPI {
  return {
    getComponents: vi.fn(async (args?: { provides?: string }) => {
      const components =
        args?.provides === "modbus" ? [{ id: "modbus_bridge" }] : CATALOG;
      return {
        components,
        categories: [],
        total: components.length,
        offset: 0,
        limit: 1000,
      };
    }),
    getComponentBodies: vi.fn(async () => ({})),
  } as unknown as ESPHomeAPI;
}

// The dialog awaits the index before it mounts the form.
async function mountForm(yaml: string, api: ESPHomeAPI = makeApi()) {
  await loadCatalog(api);
  return mountAddComponentForm({ component: cover, yaml, api });
}

const CLIENT_HUB = "uart:\n  - id: bus\nmodbus:\n  - id: client_hub\n";

describe("add-component-form wrong-kind dependency", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    _clearCatalogCache();
    _clearProvidesCache();
    _clearComponentCache();
    _clearYamlSectionsMemo();
  });

  it("holds Add behind the wrong-kind copy when only a client hub exists", async () => {
    const el = await mountForm(CLIENT_HUB);
    const warn = depsBanner(el)!;
    expect(warn.textContent).toContain("device.wrong_kind_dependency_body");
    expect(warn.textContent).not.toContain("device.missing_dependencies_body");
    expect(submitButton(el).disabled).toBe(true);
  });

  it("clears once a server hub exists", async () => {
    const el = await mountForm(`${CLIENT_HUB}  - id: server_hub\n    role: server\n`);
    expect(depsBanner(el)).toBeNull();
  });

  it("counts a hub id a configured provider supplies", async () => {
    const el = await mountForm(`${CLIENT_HUB}modbus_bridge:\n  id: bridged_hub\n`);
    expect(depsBanner(el)).toBeNull();
  });
});
